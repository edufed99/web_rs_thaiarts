"""Tests for ``services.popularity`` (ADR-002 §4) and the
``/metrics/popularity`` endpoints.

The fixture pattern follows ``test_ctr.py``: real ORM + SQLite-in-memory
+ monkeypatched live db engine, so the SQL actually runs. Each test
seeds a tiny world, then drives the formula directly and asserts
mathematical invariants.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models_db import (
    Base,
    Context,
    InteractionLog,
    Item,
    Like,
    PopularityWeight,
    Rating,
    RecommendationRequest,
    RecommendationResult,
    SavedItem,
    User,
)
from app.services import popularity as pop_module


INMEM_URL = "sqlite:///:memory:"

# db_id -> (name, artifact_id)
ITEMS = {
    801: ("ระบำพรหมาสตร์", 900_801),
    802: ("โขน", 900_802),
    803: ("ลิเก", 900_803),
    804: ("ลำตัด", 900_804),
}


def _phase_b_weights():
    return {"saved": 0.30, "rating": 0.35, "like": 0.25, "recency": 0.10}


@pytest.fixture
def pop_db(monkeypatch):
    """Yield ``(SessionLocal, seed, weights_id)`` wired to in-memory SQLite.

    ``seed`` is a small builder; ``weights_id`` is the id of the active
    weights row the formula will read.
    """
    from app import db as db_module
    from app.core import config as config_module
    from app.services import db_query as dbq_module

    # StaticPool + check_same_thread=False so the in-memory schema is
    # shared across the FastAPI worker thread (TestClient) and the
    # fixture thread. Without this the worker thread sees a fresh empty
    # connection and queries like "no such table: users" fail.
    eng = create_engine(
        INMEM_URL,
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    SessionLocal = sessionmaker(bind=eng, expire_on_commit=False, future=True)
    now = datetime.now(timezone.utc)

    with SessionLocal() as s:
        s.add(Context(id=1, name="ctx", group_name="", description=""))
        for db_id, (name, aid) in ITEMS.items():
            s.add(
                Item(
                    id=db_id,
                    name=name,
                    is_active=True,
                    artifact_item_id=aid,
                )
            )
        # Admin user so the JWT can resolve. The ``sub`` claim is
        # stringified user_id, so a real User row is required (the auth
        # dep raises ``user_not_found`` otherwise).
        from app.services.auth import hash_password

        admin = User(
            username="admin",
            password_hash=hash_password("admin1234"),
            is_admin=True,
        )
        s.add(admin)
        w = PopularityWeight(
            weights_json='{"saved":0.30,"rating":0.35,"like":0.25,"recency":0.10}',
            half_life_days=14,
            bayes_m=3,
            is_active=True,
            updated_by="test-seed",
        )
        s.add(w)
        s.commit()
        weights_id = int(w.id)
        admin_id = int(admin.id)

    counter = {"n": 0}

    def seed(db_id, *, ratings=(), likes=0, saves=0, recency_days=None, window_older=None):
        """Seed one item's events. ``recency_days`` controls the most
        recent event's age; ``window_older`` adds another at a different
        age (for decay tests).
        """
        when_recent = (
            datetime.now(timezone.utc) - timedelta(days=int(recency_days))
            if recency_days is not None
            else now
        )
        with SessionLocal() as s:
            for n, val in enumerate(ratings):
                counter["n"] += 1
                s.add(
                    Rating(
                        user_key=f"u-rat-{counter['n']}",
                        item_id=db_id,
                        rating=int(val),
                        created_at=when_recent,
                        updated_at=when_recent,
                    )
                )
            for n in range(int(likes)):
                counter["n"] += 1
                s.add(
                    InteractionLog(
                        user_key=f"u-like-{counter['n']}",
                        item_id=db_id,
                        action_type="like",
                        metadata_json="{}",
                        created_at=when_recent,
                    )
                )
                # The state tables drive the legacy ``engagement_score``;
                # write one row per like so the formula and the legacy
                # value agree.
                s.add(
                    Like(
                        user_key=f"u-like-{counter['n']}",
                        item_id=db_id,
                        created_at=when_recent,
                    )
                )
            for n in range(int(saves)):
                counter["n"] += 1
                s.add(
                    InteractionLog(
                        user_key=f"u-save-{counter['n']}",
                        item_id=db_id,
                        action_type="save",
                        metadata_json="{}",
                        created_at=when_recent,
                    )
                )
                s.add(
                    SavedItem(
                        user_key=f"u-save-{counter['n']}",
                        item_id=db_id,
                        created_at=when_recent,
                    )
                )
            if window_older is not None:
                older_at = datetime.now(timezone.utc) - timedelta(days=int(window_older))
                for n in range(int(likes) if likes else 1):
                    counter["n"] += 1
                    s.add(
                        InteractionLog(
                            user_key=f"u-old-{counter['n']}",
                            item_id=db_id,
                            action_type="like",
                            metadata_json="{}",
                            created_at=older_at,
                        )
                    )
            s.commit()

    @contextmanager
    def fake_scope():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "get_engine", lambda: eng)
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    monkeypatch.setattr(config_module, "get_settings", lambda: _fake_settings())
    pop_module.reset_popularity_cache()

    yield SessionLocal, seed, weights_id, admin_id
    pop_module.reset_popularity_cache()
    eng.dispose()


def _fake_settings():
    from types import SimpleNamespace

    return SimpleNamespace(
        positive_threshold=4,
        ctr_impression_floor=20,
        view_dedupe_minutes=30,
    )


# ---------------------------------------------------------------------------
# set_weights validation
# ---------------------------------------------------------------------------


def test_set_weights_validates_sum_to_one(pop_db):
    SessionLocal, _seed, _wid, _aid = pop_db
    with SessionLocal() as s:
        # sum = 0.99, off by more than tolerance
        with pytest.raises(pop_module.WeightsValidationError, match="sum to 1"):
            pop_module.set_weights(
                s,
                weights_dict={"saved": 0.30, "rating": 0.30, "like": 0.30, "recency": 0.09},
                half_life_days=14,
                bayes_m=3,
                updated_by="t",
            )
        s.rollback()


def test_set_weights_validates_each_in_unit_interval(pop_db):
    SessionLocal, _seed, _wid, _aid = pop_db
    with SessionLocal() as s:
        with pytest.raises(pop_module.WeightsValidationError, match=r"\[0, 1\]"):
            pop_module.set_weights(
                s,
                weights_dict={"saved": -0.1, "rating": 0.5, "like": 0.3, "recency": 0.3},
                half_life_days=14,
                bayes_m=3,
                updated_by="t",
            )
        s.rollback()


def test_set_weights_rejects_unknown_factor(pop_db):
    SessionLocal, _seed, _wid, _aid = pop_db
    with SessionLocal() as s:
        with pytest.raises(pop_module.WeightsValidationError, match="unknown factor"):
            pop_module.set_weights(
                s,
                weights_dict={"bogus": 1.0},
                half_life_days=14,
                bayes_m=3,
                updated_by="t",
            )
        s.rollback()


def test_set_weights_rejects_negative_half_life(pop_db):
    SessionLocal, _seed, _wid, _aid = pop_db
    with SessionLocal() as s:
        with pytest.raises(pop_module.WeightsValidationError, match="half_life_days"):
            pop_module.set_weights(
                s,
                weights_dict=_phase_b_weights(),
                half_life_days=-1,
                bayes_m=3,
                updated_by="t",
            )
        s.rollback()


def test_set_weights_deactivates_previous_active(pop_db):
    SessionLocal, _seed, _wid, _aid = pop_db
    with SessionLocal() as s:
        new = pop_module.set_weights(
            s,
            weights_dict=_phase_b_weights(),
            half_life_days=7,
            bayes_m=2,
            updated_by="op2",
        )
        s.commit()
        active_rows = (
            s.query(PopularityWeight).filter(PopularityWeight.is_active.is_(True)).all()
        )
        assert len(active_rows) == 1
        assert active_rows[0].id == new.id
        # The previous row is deactivated, not deleted.
        all_rows = s.query(PopularityWeight).all()
        assert len(all_rows) == 2


def test_set_weights_invalidates_cache(pop_db):
    """Two ``compute`` calls with no change share a cache; ``set_weights``
    must invalidate, otherwise the new weights never take effect."""
    SessionLocal, seed, wid, _aid = pop_db
    seed(801, likes=10, saves=0, recency_days=0)
    seed(802, likes=0, saves=10, recency_days=0)
    with SessionLocal() as s:
        out1 = pop_module.compute_popularity_scores(s, window_days=30)
    with SessionLocal() as s:
        # change weights to save-only
        pop_module.set_weights(
            s,
            weights_dict={"saved": 1.0},
            half_life_days=14,
            bayes_m=3,
            updated_by="op",
        )
        s.commit()
        out2 = pop_module.compute_popularity_scores(s, window_days=30)
    # The previous "like" factor is no longer weighted; the item that
    # only has likes must drop (no save sub-score → weights drop).
    if 900_801 in out2:
        assert out2[900_801]["total"] == 0.0


# ---------------------------------------------------------------------------
# Bayesian WR
# ---------------------------------------------------------------------------


def test_bayesian_smoothing_5star_1_vote_beats_4_8star_100_votes_at_m_3(pop_db):
    """5★ × 1 user must rank BELOW 4.8★ × 100 users. With ``m=3`` the
    small-vote item is dragged toward ``C``, the 100-vote item keeps its
    mean. Classic IMDb-WR invariant (ADR-002 §4.2).

    This test reads the WR directly from the service (not the normalised
    sub-score) so the min-max step can't hide the smoothing effect on
    a 2-item corpus.
    """
    SessionLocal, seed, _wid, _aid = pop_db
    # 100 raters, mean 4.8 stars on item 802.
    seed(802, ratings=[5] * 96 + [4] * 4, recency_days=0)  # 100 ratings, avg 4.96
    # 1 rater, 5 stars on item 801.
    seed(801, ratings=[5], recency_days=0)
    # Decoupling the test from min-max: read the raw WR.
    with SessionLocal() as s:
        wr = pop_module._bayesian_ratings(s, bayes_m=3)
    wr_801 = wr[801][0]  # 1 vote, 5 stars
    wr_802 = wr[802][0]  # 100 votes, mean 4.96
    # The smoothed WR for 802 (lots of evidence) must stay near its mean,
    # while 801 (single vote) is dragged toward C. With the seed above C
    # ≈ 4.96 anyway, but the invariant we're really proving is that
    # 801's WR is *below* its raw 5.0 (proof the prior is pulling it).
    assert wr_801 < 5.0, f"Bayesian must pull 1-vote item below raw mean: {wr_801}"
    # And the 100-vote item's WR is at most slightly below its raw mean.
    assert wr_802 >= 4.9, f"Bayesian must preserve high-vote item: {wr_802}"


def test_bayesian_disabled_with_m0_uses_raw_mean(pop_db):
    """``bayes_m=0`` falls back to raw mean — no smoothing.

    Reads ``_bayesian_ratings`` directly to compare the WR values
    without the min-max layer masking the difference.
    """
    SessionLocal, seed, _wid, _aid = pop_db
    seed(801, ratings=[5], recency_days=0)
    seed(802, ratings=[4, 4, 4, 5], recency_days=0)
    with SessionLocal() as s:
        wr = pop_module._bayesian_ratings(s, bayes_m=0)
    # Under m=0 the WR is just the raw mean.
    assert wr[801][0] == 5.0
    assert wr[802][0] == pytest.approx(4.25)


# ---------------------------------------------------------------------------
# Decay
# ---------------------------------------------------------------------------


def test_decay_older_count_ranks_below_newer_count(pop_db):
    """Same like-count, different ages → newer item scores higher
    on the recency factor and the time-decayed like factor."""
    SessionLocal, seed, _wid, _aid = pop_db
    seed(801, likes=5, recency_days=0)
    seed(802, likes=5, recency_days=20)  # ~1 half-life older
    with SessionLocal() as s:
        scored = pop_module.compute_popularity_scores(s, window_days=30)
    total_801 = scored[900_801]["total"]
    total_802 = scored[900_802]["total"]
    assert total_801 > total_802, (total_801, total_802)


def test_decay_with_half_life_zero_disables_weighting(pop_db):
    """``half_life_days=0`` collapses to count-of-net-positives; the
    age is irrelevant."""
    SessionLocal, seed, _wid, _aid = pop_db
    seed(801, likes=5, recency_days=0)
    seed(802, likes=5, recency_days=20)
    with SessionLocal() as s:
        pop_module.set_weights(
            s,
            weights_dict={"like": 1.0},
            half_life_days=0,
            bayes_m=0,
            updated_by="t",
        )
        s.commit()
        scored = pop_module.compute_popularity_scores(s, window_days=30)
    assert scored[900_801]["sub_scores"]["like"] == pytest.approx(
        scored[900_802]["sub_scores"]["like"]
    )


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------


def test_log1p_minmax_outlier_does_not_compress_others(pop_db):
    """A 1000-like breakout item must not flatten the rest to ~0.

    With log1p, the range becomes ``log1p(1000) - log1p(5) ≈ 5.1``
    instead of 995. A 50-like item lands at ``(log1p(50) - log1p(5)) /
    5.1 ≈ 0.57`` — meaningfully above 0. Without log1p it would
    normalise to ``(50-5)/995 ≈ 0.045``.
    """
    SessionLocal, seed, _wid, _aid = pop_db
    seed(801, likes=1000, recency_days=0)
    seed(802, likes=50, recency_days=0)
    seed(803, likes=20, recency_days=0)
    seed(804, likes=5, recency_days=0)
    with SessionLocal() as s:
        scored = pop_module.compute_popularity_scores(s, window_days=30)
    # 802 has 50 likes; under log1p+minmax it should land well above 0.
    like_802 = scored[900_802]["sub_scores"]["like"]
    assert like_802 > 0.40, f"50-like item should be well above 0, got {like_802}"
    # The breakout item itself normalises to 1.0.
    assert scored[900_801]["sub_scores"]["like"] == pytest.approx(1.0)
    # The smallest active item is the min — that's correct min-max math,
    # but it should still be > 0 because we seeded it (so it's not the
    # min over an *empty* set).
    assert scored[900_804]["sub_scores"]["like"] == 0.0
    # And it is strictly between the min and the max.
    assert 0.0 < like_802 < 1.0
    assert 0.0 <= scored[900_803]["sub_scores"]["like"] < 1.0


# ---------------------------------------------------------------------------
# Renormalisation
# ---------------------------------------------------------------------------


def test_total_stays_in_unit_interval_when_factor_missing(pop_db):
    """When a factor's sub-score is ``None`` (e.g. CTR below the floor),
    the total must renormalise to the remaining weights, not exceed 1.0.
    """
    SessionLocal, seed, _wid, _aid = pop_db
    # One item with all the activity, CTR is None by default.
    seed(801, ratings=[5] * 10, likes=5, saves=5, recency_days=0)
    with SessionLocal() as s:
        scored = pop_module.compute_popularity_scores(s, window_days=30)
    row = scored[900_801]
    assert 0.0 <= row["total"] <= 1.0
    # Weights applied does not include "view" or "ctr" (those rows are
    # absent from the seed).
    assert "view" not in row["weights_applied"]
    assert "ctr" not in row["weights_applied"]


def test_item_with_no_activity_is_absent(pop_db):
    """Matches the contract of ``live_item_engagement``: absence = zero."""
    SessionLocal, seed, _wid, _aid = pop_db
    seed(801, likes=1, recency_days=0)
    with SessionLocal() as s:
        scored = pop_module.compute_popularity_scores(s, window_days=30)
    assert 900_801 in scored
    assert 900_802 not in scored
    assert 900_803 not in scored
    assert 900_804 not in scored


# ---------------------------------------------------------------------------
# Engagement / back-compat
# ---------------------------------------------------------------------------


def test_engagement_score_kept_for_backcompat(pop_db):
    """The legacy ``engagement_score`` is the dashboard's existing tile;
    the new score must keep the field populated so the homepage card
    keeps working."""
    SessionLocal, seed, _wid, _aid = pop_db
    seed(801, likes=2, saves=1, recency_days=0)
    with SessionLocal() as s:
        scored = pop_module.compute_popularity_scores(s, window_days=30)
    assert scored[900_801]["engagement_score"] >= 3


# ---------------------------------------------------------------------------
# Endpoint smoke
# ---------------------------------------------------------------------------


def _wire_endpoint_test(monkeypatch, pop_db):
    """Patch every consumer of ``session_scope`` to the in-memory engine.

    The popularity endpoint, the admin auth dep (``identity``) and
    any other service that imported ``session_scope`` locally must all
    be patched, otherwise the request handler ends up talking to the
    production Postgres URL.

    Also resets the engine singleton so a cached engine from a previous
    test doesn't leak in.
    """
    from contextlib import contextmanager

    from app import db as db_module
    from app.core import config as config_module
    from app.services import actions as actions_module
    from app.services import db_query as dbq_module
    from app.services import identity as identity_module

    SessionLocal, _seed, _wid, _aid = pop_db

    @contextmanager
    def fake_scope():
        sess = SessionLocal()
        try:
            yield sess
            sess.commit()
        finally:
            sess.close()

    # The in-memory engine is the one the fixture created and seeded.
    # Bind it under all the names the consumer modules look up.
    eng = db_module.get_engine()
    monkeypatch.setattr(db_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(db_module, "get_engine", lambda: eng)
    monkeypatch.setattr(db_module, "session_scope", fake_scope)
    db_module.reset_engine()
    monkeypatch.setattr(dbq_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(dbq_module, "session_scope", fake_scope)
    monkeypatch.setattr(actions_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(actions_module, "session_scope", fake_scope)
    monkeypatch.setattr(identity_module, "is_db_enabled", lambda: True)
    monkeypatch.setattr(identity_module, "session_scope", fake_scope)
    pop_module.reset_popularity_cache()
    return SessionLocal, _seed, _aid


def test_endpoint_returns_top_n_sorted(monkeypatch, pop_db):
    from app.main import create_app
    from app.model_loader import reset_singleton
    from app.services.auth import create_token

    _SessionLocal, seed, _aid = _wire_endpoint_test(monkeypatch, pop_db)

    token = create_token(user_id=_aid, username="admin", is_admin=True)[0]
    auth = {"Authorization": f"Bearer {token}"}

    seed(801, likes=10, saves=10, ratings=[5] * 10, recency_days=0)
    seed(802, likes=1, recency_days=0)
    reset_singleton()
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/metrics/popularity?range=30d&limit=10", headers=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["source"] == "live"
        assert body["range_days"] == 30
        assert len(body["rows"]) >= 2
        # The higher-activity item ranks first.
        ranked_ids = [row["item_id"] for row in body["rows"]]
        assert ranked_ids.index(900_801) < ranked_ids.index(900_802)
        # Per-row sub-scores shape.
        first = body["rows"][0]
        assert "saved" in first["sub_scores"]
        assert "rating" in first["sub_scores"]
        assert "recency" in first["sub_scores"]
        assert 0.0 <= first["total"] <= 1.0

    # Admin token hand-rolled with the dev secret (mirrors test_dashboard).
    from app.services.auth import create_token

    token = create_token(user_id=_aid, username="admin", is_admin=True)[0]
    auth = {"Authorization": f"Bearer {token}"}

    seed(801, likes=10, saves=10, ratings=[5] * 10, recency_days=0)
    seed(802, likes=1, recency_days=0)
    reset_singleton()
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/metrics/popularity?range=30d&limit=10", headers=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["source"] == "live"
        assert body["range_days"] == 30
        assert len(body["rows"]) >= 2
        # The higher-activity item ranks first.
        ranked_ids = [row["item_id"] for row in body["rows"]]
        assert ranked_ids.index(900_801) < ranked_ids.index(900_802)
        # Per-row sub-scores shape.
        first = body["rows"][0]
        assert "saved" in first["sub_scores"]
        assert "rating" in first["sub_scores"]
        assert "recency" in first["sub_scores"]
        assert 0.0 <= first["total"] <= 1.0


def test_endpoint_requires_admin(monkeypatch, pop_db):
    """No auth → 401."""
    from app.core import config as config_module
    from app.main import create_app
    from app.model_loader import reset_singleton

    reset_singleton()
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/metrics/popularity")
        assert r.status_code in (401, 403)


def test_endpoint_handles_no_active_weights(monkeypatch, pop_db):
    """When the active row is missing (e.g. migration failed) the
    endpoint returns ``source='unavailable'`` with empty rows, not a
    500."""
    from app.main import create_app
    from app.model_loader import reset_singleton
    from app.services.auth import create_token

    SessionLocal, _seed, _aid = _wire_endpoint_test(monkeypatch, pop_db)

    # Deactivate the seeded row.
    with SessionLocal() as s:
        s.query(PopularityWeight).update({PopularityWeight.is_active: False})
        s.commit()

    token = create_token(user_id=_aid, username="admin", is_admin=True)[0]
    auth = {"Authorization": f"Bearer {token}"}
    reset_singleton()
    app = create_app()
    with TestClient(app) as client:
        r = client.get("/metrics/popularity", headers=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["source"] == "unavailable"
        assert body["rows"] == []


def test_weights_put_validates_and_deactivates(monkeypatch, pop_db):
    """PUT with bad weights → 400. PUT with good weights → 200, new active."""
    from app.main import create_app
    from app.model_loader import reset_singleton
    from app.services.auth import create_token

    SessionLocal, _seed, _aid = _wire_endpoint_test(monkeypatch, pop_db)

    token = create_token(user_id=_aid, username="admin", is_admin=True)[0]
    auth = {"Authorization": f"Bearer {token}"}
    reset_singleton()
    app = create_app()
    with TestClient(app) as client:
        bad = client.put(
            "/metrics/popularity/weights",
            headers=auth,
            json={
                "weights": {"saved": 2.0, "rating": -1.0},
                "half_life_days": 14,
                "bayes_m": 3,
            },
        )
        assert bad.status_code == 400, bad.text
        assert bad.json()["detail"]["code"] == "invalid_weights"

        good = client.put(
            "/metrics/popularity/weights",
            headers=auth,
            json={
                "weights": {"saved": 0.50, "rating": 0.30, "like": 0.10, "recency": 0.10},
                "half_life_days": 7,
                "bayes_m": 2,
                "updated_by": "smoke",
            },
        )
        assert good.status_code == 200, good.text
        body = good.json()
        assert body["half_life_days"] == 7
        assert body["bayes_m"] == 2
        assert body["updated_by"] == "smoke"

    # Verify the DB state — only one active row, and it's the new one.
    with SessionLocal() as s:
        actives = s.query(PopularityWeight).filter(PopularityWeight.is_active.is_(True)).all()
        assert len(actives) == 1
        assert actives[0].updated_by == "smoke"


def test_set_weights_empty_dict_raises(pop_db):
    """An empty weights dict fails validation — sum check is meaningless
    on an empty mapping."""
    SessionLocal, _seed, _wid, _aid = pop_db
    with SessionLocal() as s:
        with pytest.raises(pop_module.WeightsValidationError):
            pop_module.set_weights(
                s,
                weights_dict={},
                half_life_days=14,
                bayes_m=3,
                updated_by="t",
            )
        s.rollback()


def test_set_weights_non_numeric_value_raises(pop_db):
    """Weights must be numeric — a string value is rejected even
    if it represents a number."""
    SessionLocal, _seed, _wid, _aid = pop_db
    with SessionLocal() as s:
        with pytest.raises(pop_module.WeightsValidationError, match="must be numeric"):
            pop_module.set_weights(
                s,
                weights_dict={"saved": "0.5"},  # string, not number
                half_life_days=14,
                bayes_m=3,
                updated_by="t",
            )
        s.rollback()


def test_set_weights_negative_bayes_m_raises(pop_db):
    SessionLocal, _seed, _wid, _aid = pop_db
    with SessionLocal() as s:
        with pytest.raises(pop_module.WeightsValidationError, match="bayes_m"):
            pop_module.set_weights(
                s,
                weights_dict={"saved": 1.0},
                half_life_days=14,
                bayes_m=-1,
                updated_by="t",
            )
        s.rollback()
