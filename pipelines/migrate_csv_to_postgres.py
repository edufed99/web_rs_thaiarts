"""
migrate_csv_to_postgres.py — One-shot CSV → Postgres loader.

Reads the legacy Django PostgreSQL export at ``db_csv_export_*/`` (UTF-8
with BOM, comma-separated) and loads it into the live
``web_rs_thaiarts`` Postgres database. The legacy project at
``../web_appRS/thai_arts_webapp/`` is never modified.

Schema management:
    The target schema is owned by Alembic (see ``backend/migrations/``).
    This script calls ``alembic upgrade head`` automatically before
    importing data. Pass ``--skip-alembic`` to skip the schema step.

What it migrates (read from CSV in FK-safe order):
    1. taxonomy_nodes            (no FK)
    2. keywords                  (FK -> taxonomy_nodes)
    3. contexts                  (no FK)
    4. items                     (artifact_item_id generated via stable_id)
    5. item_contexts             (FK -> items, contexts)
    6. item_keywords             (FK -> items, keywords)
    7. legacy_interactions       (FK -> items, contexts)
    8. users                     (custom; passwords REDACTED → bcrypt hash
                                  with a must_reset_password flag stored
                                  in display_name marker; legacy_user_id
                                  kept in display_name as 'legacy:X')
    9. accounts_userprofile      (FK -> users; role drives is_admin on users)
   10. recommendation_requests   (FK -> users, contexts)
   11. recommendation_request_selected_keywords  (M2M)
   12. recommendation_results    (FK -> request, item)
   13. likes                    (FK -> users by user_key translation)
   14. ratings                  (FK -> users by user_key translation)
   15. saved_items              (FK -> users by user_key translation)
   16. interaction_logs         (FK -> users by user_key translation)

User key translation:
    CSV ``auth_user.id`` -> ``users.id`` is an offset+1 because the live
    DB has ``users.id=1, username='admin'`` (created during Phase H bootstrap).
    The script preserves ``legacy_user_id`` (CSV column) into the
    ``display_name`` of the new user as ``legacy:<legacy_user_id>`` so the
    DB-side helper ``user_key`` translations remain possible later.

    For likes/ratings/saved_items/interaction_logs the CSV
    ``user_id`` (Django FK) is resolved against the freshly-imported user
    map. The ``user_key`` written to those tables is the original
    ``username`` (e.g. ``บุคคล1``) — matches the ``legacy:<x>`` style used
    by the migration from SQLite.

What it does NOT migrate (out of scope):
    django_*, auth_group*, auth_permission* — Django built-ins,
    not used in web_rs_thaiarts.
    recommender_itemembedding — recomputed by
    train_or_generate_artifacts.py.

The legacy project is never modified. This script only reads the
``db_csv_export_*`` directory.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import bcrypt
from sqlalchemy import MetaData, create_engine, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Config + CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Migrate legacy CSV export -> web_rs_thaiarts Postgres."
    )
    p.add_argument(
        "--csv-dir",
        required=True,
        help="Path to the CSV export directory (contains manifest.csv).",
    )
    p.add_argument(
        "--target-url",
        required=True,
        help="SQLAlchemy URL for the target Postgres database.",
    )
    p.add_argument(
        "--skip-alembic",
        action="store_true",
        help="Skip 'alembic upgrade head'. Use only when the schema is known to be at head.",
    )
    p.add_argument(
        "--truncate",
        action="store_true",
        help="TRUNCATE the destination tables before importing. DESTRUCTIVE.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate + parse CSVs without writing to Postgres.",
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_csv(path: Path) -> Iterable[Dict[str, str]]:
    """Read a CSV file (UTF-8 with BOM) as a stream of row dicts."""
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _stable_id(kind: str, name: str) -> int:
    """Mirror app.services._ids.stable_id + train_or_generate_artifacts.stable_id."""
    h = hashlib.sha256(f"{kind}::{name}".encode("utf-8")).hexdigest()
    return int(h[:7], 16)


def _int_or_none(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    return int(v)


def _bool_or_default(v: Any, default: bool = False) -> bool:
    if v is None or v == "":
        return default
    return v.strip().lower() in ("true", "1", "t", "yes")


def _run_alembic_upgrade_head(url) -> None:
    """Invoke ``alembic upgrade head`` from the backend/ directory."""
    import subprocess

    backend_dir = Path(__file__).resolve().parent.parent / "backend"
    if not (backend_dir / "alembic.ini").exists():
        print(
            "WARN: backend/alembic.ini not found — skipping schema upgrade. "
            "Run 'alembic upgrade head' manually if the schema is missing.",
            file=sys.stderr,
        )
        return

    env = os.environ.copy()
    env["RECSYS_DATABASE_URL"] = str(url.render_as_string(hide_password=False))
    env.setdefault("RECSYS_DB_ENABLED", "1")

    print(f"Running 'alembic upgrade head' against {url} ...")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(backend_dir),
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise RuntimeError(f"alembic upgrade head failed (exit {result.returncode})")
    for line in result.stdout.strip().splitlines()[-3:]:
        print("  ", line)


def upsert(session, table, payload: List[Dict], index_elements: List[str]) -> int:
    """PostgreSQL upsert via ON CONFLICT DO NOTHING."""
    if not payload:
        return 0
    stmt = pg_insert(table).values(payload)
    stmt = stmt.on_conflict_do_nothing(index_elements=index_elements)
    session.execute(stmt)
    return len(payload)


# ---------------------------------------------------------------------------
# Migrators (one per table)
# ---------------------------------------------------------------------------


def migrate_taxonomy(session, csv_dir: Path) -> int:
    rows = _read_csv(csv_dir / "catalog_taxonomynode.csv")
    payload = [
        {"id": int(r["id"]), "name": r["name"], "level": int(r["level"]),
         "parent_id": _int_or_none(r["parent_id"])}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["taxonomy_nodes"], payload, ["id"])


def migrate_keywords(session, csv_dir: Path) -> int:
    rows = _read_csv(csv_dir / "catalog_keyword.csv")
    payload = [
        {"id": int(r["id"]), "name": r["name"],
         "taxonomy_node_id": _int_or_none(r["taxonomy_node_id"])}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["keywords"], payload, ["id"])


def migrate_contexts(session, csv_dir: Path) -> int:
    rows = _read_csv(csv_dir / "catalog_context.csv")
    payload = [
        {"id": int(r["id"]), "name": r["name"],
         "group_name": r["group"] or "", "description": r["description"] or ""}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["contexts"], payload, ["id"])


def migrate_items(session, csv_dir: Path) -> int:
    rows = _read_csv(csv_dir / "catalog_item.csv")
    payload = []
    for r in rows:
        artifact_id = _stable_id("item", r["name"])
        payload.append({
            "id": int(r["id"]),
            "name": r["name"],
            "description": r["description"] or "",
            "category_group": r["category_group"] or "",
            "performance_type": r["performance_type"] or "",
            "performers_count": _int_or_none(r["performers_count"]),
            "duration_minutes": _int_or_none(r["duration_minutes"]),
            "price_text": r["price_text"] or "",
            "image_url": r["image_url"] or "",
            "video_url": r["video_url"] or "",
            "is_active": _bool_or_default(r["is_active"], True),
            "artifact_item_id": artifact_id,
        })
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["items"], payload, ["id"])


def migrate_item_contexts(session, csv_dir: Path) -> int:
    rows = _read_csv(csv_dir / "catalog_itemcontext.csv")
    payload = [
        {"id": int(r["id"]), "item_id": int(r["item_id"]),
         "context_id": int(r["context_id"]),
         "validity_status": r["validity_status"] or "valid"}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["item_contexts"], payload, ["id"])


def migrate_item_keywords(session, csv_dir: Path) -> int:
    rows = _read_csv(csv_dir / "catalog_itemkeyword.csv")
    payload = [
        {"id": int(r["id"]), "item_id": int(r["item_id"]),
         "keyword_id": int(r["keyword_id"]), "source": r["source"] or ""}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["item_keywords"], payload, ["id"])


def migrate_legacy_interactions(session, csv_dir: Path) -> int:
    """Map legacy_user_id → legacy_user_id (no FK to users because legacy
    semantics already use the legacy_user_id string).
    """
    rows = _read_csv(csv_dir / "recommender_legacyinteraction.csv")
    payload = []
    for r in rows:
        kw_raw = r["keywords"] or "[]"
        try:
            parsed = json.loads(kw_raw)
            keywords = parsed if isinstance(parsed, list) else []
        except (ValueError, TypeError):
            keywords = []
        payload.append({
            "id": int(r["id"]),
            "legacy_user_id": r["legacy_user_id"],
            "item_id": int(r["item_id"]),
            "context_id": _int_or_none(r["context_id"]),
            "rating": int(r["rating"]),
            "keywords": json.dumps(keywords, ensure_ascii=False),
            "raw_item_name": r["raw_item_name"] or "",
            "imported_at": r["imported_at"],
        })
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["legacy_interactions"], payload, ["id"])


def migrate_users(session, csv_dir: Path) -> Dict[int, int]:
    """Import auth_user. Passwords are REDACTED so we hash a random
    unrecoverable token + flag display_name with 'must_reset'.

    Returns a map: CSV auth_user.id -> PG users.id.
    """
    rows = _read_csv(csv_dir / "auth_user.csv")
    # The live users table has id=1 reserved for the bootstrap admin
    # created during Phase H. CSV auth_user starts at id=5 (admin=pichaya).
    # We OFFSET new IDs by +1 so that all CSV users land at id>=2.
    bind = session.get_bind()
    max_existing = session.execute(
        text("SELECT COALESCE(MAX(id), 0) FROM users")
    ).scalar_one()
    id_offset = max(0, max_existing - 1)  # next id is max_existing+1

    payload = []
    id_map: Dict[int, int] = {}
    for r in rows:
        csv_id = int(r["id"])
        # Random unrecoverable hash so the user MUST reset password.
        random_token = bcrypt.gensalt(rounds=4).decode("ascii")
        new_id = max_existing + (csv_id - 1)  # CSV id 1->max+0, CSV id 2->max+1, ...
        id_map[csv_id] = new_id
        payload.append({
            "id": new_id,
            "username": r["username"],
            "password_hash": f"!redacted!{random_token}",
            "display_name": f"must_reset|legacy:{r['username']}",
            "is_admin": _bool_or_default(r["is_superuser"], False),
            "created_at": r["date_joined"],
            "last_login_at": r["last_login"] if r["last_login"] else None,
        })
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    upsert(session, meta.tables["users"], payload, ["id"])
    return id_map


def migrate_userprofiles(session, csv_dir: Path, id_map: Dict[int, int]) -> int:
    rows = _read_csv(csv_dir / "accounts_userprofile.csv")
    payload = []
    for r in rows:
        csv_user_id = int(r["user_id"])
        if csv_user_id not in id_map:
            continue
        payload.append({
            "id": int(r["id"]),
            "user_id": id_map[csv_user_id],
            "display_name": r["display_name"] or "",
            "role": r["role"] or "user",
            "user_group": r["user_group"] or "",
            "experience_level": r["experience_level"] or "none",
            "consent_accepted": _bool_or_default(r["consent_accepted"], False),
            "consent_version": r["consent_version"] or "",
            "consent_accepted_at": r["consent_accepted_at"] or None,
            "consent_withdrawn_at": r["consent_withdrawn_at"] or None,
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        })
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["accounts_userprofile"], payload, ["id"])


def migrate_recommendation_requests(
    session, csv_dir: Path, id_map: Dict[int, int]
) -> int:
    rows = _read_csv(csv_dir / "recommender_recommendationrequest.csv")
    payload = []
    for r in rows:
        csv_user_id = _int_or_none(r["user_id"])
        pg_user_id = id_map.get(csv_user_id) if csv_user_id else None
        payload.append({
            "id": int(r["id"]),
            "user_id": pg_user_id,
            "selected_context_id": int(r["selected_context_id"]),
            "candidate_count": int(r["candidate_count"]),
            "top_k": int(r["top_k"]),
            "method": r["method"],
            "metadata_json": r["metadata"] or "",
            "created_at": r["created_at"],
        })
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["recommendation_requests"], payload, ["id"])


def migrate_request_selected_keywords(session, csv_dir: Path) -> int:
    rows = _read_csv(csv_dir / "recommender_recommendationrequest_selected_keywords.csv")
    payload = [
        {"id": int(r["id"]),
         "request_id": int(r["recommendationrequest_id"]),
         "keyword_id": int(r["keyword_id"])}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(
        session,
        meta.tables["recommendation_request_selected_keywords"],
        payload,
        ["id"],
    )


def migrate_recommendation_results(session, csv_dir: Path) -> int:
    rows = _read_csv(csv_dir / "recommender_recommendationresult.csv")
    payload = []
    for r in rows:
        kw_raw = r["matched_keywords"] or "[]"
        try:
            parsed = json.loads(kw_raw)
            mk = parsed if isinstance(parsed, list) else []
        except (ValueError, TypeError):
            mk = []
        payload.append({
            "id": int(r["id"]),
            "request_id": int(r["request_id"]),
            "item_id": int(r["item_id"]),
            "rank": int(r["rank"]),
            "cbf_score": float(r["cbf_score"]),
            "cf_score": float(r["cf_score"]),
            "hybrid_score": float(r["hybrid_score"]),
            "is_context_valid": _bool_or_default(r["is_context_valid"], True),
            "matched_keywords_json": json.dumps(mk, ensure_ascii=False),
            "explanation": r["explanation"] or "",
        })
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["recommendation_results"], payload, ["id"])


def _user_key_from_csv_id(session: Session, id_map: Dict[int, int], csv_user_id: Any) -> str:
    """Translate CSV auth_user.id to a user_key we can store.

    The live ``likes``/``ratings``/``saved_items``/``interaction_logs``
    tables use ``user_key VARCHAR(150)`` (not a FK). For imported rows we
    use ``legacy:<username>`` so future joins can find the user by
    ``users.username``. Falls back to ``"anon:unknown-<csv_id>"`` if the
    csv_user_id is unknown.
    """
    if not csv_user_id:
        return ""
    try:
        csv_id_int = int(csv_user_id)
    except (ValueError, TypeError):
        return ""
    pg_user_id = id_map.get(csv_id_int)
    if pg_user_id is None:
        return f"anon:unknown-{csv_id_int}"
    username = session.execute(
        text("SELECT username FROM users WHERE id = :i"), {"i": pg_user_id}
    ).scalar_one_or_none()
    return f"legacy:{username}" if username else f"anon:unknown-{csv_id_int}"


def migrate_likes(session, csv_dir: Path, id_map: Dict[int, int]) -> int:
    rows = _read_csv(csv_dir / "recommender_like.csv")
    payload = [
        {"id": int(r["id"]),
         "user_key": _user_key_from_csv_id(session, id_map, r["user_id"]),
         "item_id": int(r["item_id"]),
         "created_at": r["created_at"]}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["likes"], payload, ["id"])


def migrate_ratings(session, csv_dir: Path, id_map: Dict[int, int]) -> int:
    rows = _read_csv(csv_dir / "recommender_rating.csv")
    payload = [
        {"id": int(r["id"]),
         "user_key": _user_key_from_csv_id(session, id_map, r["user_id"]),
         "item_id": int(r["item_id"]),
         "rating": int(r["rating"]),
         "created_at": r["created_at"],
         "updated_at": r["updated_at"]}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["ratings"], payload, ["id"])


def migrate_saved_items(session, csv_dir: Path, id_map: Dict[int, int]) -> int:
    path = csv_dir / "recommender_saveditem.csv"
    if not path.exists():
        return 0
    rows = _read_csv(path)
    if not rows:
        return 0
    payload = [
        {"id": int(r["id"]),
         "user_key": _user_key_from_csv_id(session, id_map, r["user_id"]),
         "item_id": int(r["item_id"]),
         "created_at": r["created_at"]}
        for r in rows
    ]
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["saved_items"], payload, ["id"])


def migrate_interaction_logs(session, csv_dir: Path, id_map: Dict[int, int]) -> int:
    rows = _read_csv(csv_dir / "recommender_interactionlog.csv")
    payload = []
    for r in rows:
        md_raw = r["metadata"] or ""
        payload.append({
            "id": int(r["id"]),
            "user_key": _user_key_from_csv_id(session, id_map, r["user_id"]),
            "item_id": _int_or_none(r["item_id"]),
            "action_type": r["action_type"],
            "metadata_json": md_raw,
            "created_at": r["created_at"],
            "recommendation_request_id": _int_or_none(r["recommendation_request_id"]),
        })
    meta = MetaData(); meta.reflect(bind=session.get_bind())
    return upsert(session, meta.tables["interaction_logs"], payload, ["id"])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def verify_counts(session) -> Dict[str, Tuple[int, int]]:
    """Compare live row counts against manifest.csv. Returns
    ``{table: (manifest_count, db_count)}``.
    """
    manifest_path = Path(args.csv_dir) / "manifest.csv"  # noqa: F821
    with open(manifest_path, "r", encoding="utf-8-sig") as f:
        manifest_rows = list(csv.DictReader(f))

    counts: Dict[str, Tuple[int, int]] = {}
    binding = {
        "accounts_userprofile": "accounts_userprofile",
        "catalog_context": "contexts",
        "catalog_item": "items",
        "catalog_itemcontext": "item_contexts",
        "catalog_itemkeyword": "item_keywords",
        "catalog_keyword": "keywords",
        "catalog_taxonomynode": "taxonomy_nodes",
        "recommender_interactionlog": "interaction_logs",
        "recommender_legacyinteraction": "legacy_interactions",
        "recommender_like": "likes",
        "recommender_rating": "ratings",
        "recommender_recommendationrequest": "recommendation_requests",
        "recommender_recommendationrequest_selected_keywords":
            "recommendation_request_selected_keywords",
        "recommender_recommendationresult": "recommendation_results",
        "recommender_saveditem": "saved_items",
    }
    for m_row in manifest_rows:
        m_table = m_row["table"]
        if m_table not in binding:
            continue
        pg_table = binding[m_table]
        expected = int(m_row["rows"])
        actual = session.execute(text(f"SELECT COUNT(*) FROM {pg_table}")).scalar_one()
        counts[m_table] = (expected, int(actual))
    return counts


def truncate_all(session) -> None:
    """DESTRUCTIVE: clear every data table (Alembic version preserved)."""
    tables = [
        "interaction_logs", "likes", "ratings", "saved_items",
        "recommendation_results",
        "recommendation_request_selected_keywords", "recommendation_requests",
        "accounts_userprofile",
        "legacy_interactions",
        "item_contexts", "item_keywords",
        "items", "contexts", "keywords", "taxonomy_nodes",
        "users",
    ]
    session.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))


def main() -> int:
    global args  # used by verify_counts
    args = parse_args()
    csv_dir = Path(args.csv_dir).expanduser().resolve()
    if not csv_dir.exists():
        print(f"ERROR: csv-dir not found: {csv_dir}", file=sys.stderr)
        return 2
    manifest = csv_dir / "manifest.csv"
    if not manifest.exists():
        print(f"ERROR: manifest.csv missing in {csv_dir}", file=sys.stderr)
        return 2

    print(f"Source CSV dir: {csv_dir}")
    print(f"Target URL:     {args.target_url}")
    print(f"Dry run:        {args.dry_run}")
    print(f"Truncate:       {args.truncate}")

    target = create_engine(args.target_url, future=True)

    if not args.skip_alembic:
        _run_alembic_upgrade_head(target.url)

    if args.dry_run:
        # Validate parseability only.
        for csv_path in sorted(csv_dir.glob("*.csv")):
            if csv_path.name == "manifest.csv":
                continue
            rows = _read_csv(csv_path)
            print(f"  parsed {len(rows):>6d} rows from {csv_path.name}")
        target.dispose()
        return 0

    counts: Dict[str, int] = {}
    with Session(target) as session:
        with session.begin():
            if args.truncate:
                print("Truncating destination tables ...")
                truncate_all(session)

            counts["taxonomy_nodes"] = migrate_taxonomy(session, csv_dir)
            counts["keywords"] = migrate_keywords(session, csv_dir)
            counts["contexts"] = migrate_contexts(session, csv_dir)
            counts["items"] = migrate_items(session, csv_dir)
            counts["item_contexts"] = migrate_item_contexts(session, csv_dir)
            counts["item_keywords"] = migrate_item_keywords(session, csv_dir)
            counts["legacy_interactions"] = migrate_legacy_interactions(session, csv_dir)

            id_map = migrate_users(session, csv_dir)
            counts["users"] = len(id_map)
            counts["accounts_userprofile"] = migrate_userprofiles(session, csv_dir, id_map)
            counts["recommendation_requests"] = migrate_recommendation_requests(session, csv_dir, id_map)
            counts["recommendation_request_selected_keywords"] = (
                migrate_request_selected_keywords(session, csv_dir)
            )
            counts["recommendation_results"] = migrate_recommendation_results(session, csv_dir)
            counts["likes"] = migrate_likes(session, csv_dir, id_map)
            counts["ratings"] = migrate_ratings(session, csv_dir, id_map)
            counts["saved_items"] = migrate_saved_items(session, csv_dir, id_map)
            counts["interaction_logs"] = migrate_interaction_logs(session, csv_dir, id_map)

    target.dispose()

    print()
    print("=== Migration complete ===")
    for k, v in counts.items():
        print(f"  {k:45s} {v:>6d} rows")

    # Verification — re-query counts and diff against manifest.
    print()
    print("=== Verification (manifest vs live counts) ===")
    target = create_engine(args.target_url, future=True)
    with Session(target) as session:
        diff = verify_counts(session)
    target.dispose()
    mismatches = 0
    for tbl, (expected, actual) in diff.items():
        ok = "OK " if expected == actual else "BAD"
        if expected != actual:
            mismatches += 1
        print(f"  [{ok}] {tbl:45s} manifest={expected:>5d}  live={actual:>5d}")
    if mismatches:
        print(f"\n*** {mismatches} mismatches — investigate before commit ***")
        return 1
    print("\nAll counts match manifest.csv.")
    return 0


if __name__ == "__main__":
    sys.exit(main())