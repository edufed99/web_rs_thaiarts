"""
suitability.py — Display-only match-percent computation for catalog cards.

Ported from ``catalog.views.catalog_match_percent`` / ``catalog.views.suitability_label``
in the legacy Django project
(``C:/Users/Pichaya/Downloads/web_appRS/thai_arts_webapp/catalog/views.py`` lines 157-181).

This module is **purely presentational** — it never influences the
recommendation ranking.  The hybrid score computed by
``hybrid_service.weighted_sum`` remains the sole sort key.

The match-percent is a heuristic blend of four cheap signals that are
always available from the artifact-loaded item dict:

* ``keyword_count``  — items with richer keyword metadata look more complete
* ``context_count``  — items that are specific to few contexts are ranked higher
* ``description_length`` — longer descriptions are richer
* ``rating_average``  — average user rating (defaults to 0.66 when missing,
  matching the legacy behaviour when no legacy interactions exist)

Output is an integer in **[82, 98]** (clamped).  The legacy system chose
this range intentionally: a 100% would imply a hard guarantee that we
do not have, while anything below 82 would discourage browsing.
"""
from __future__ import annotations


def catalog_match_percent(
    keyword_count: int,
    context_count: int,
    description_length: int,
    rating_average: float = 0.66,
) -> int:
    """Return the legacy match-percent for a catalog item.

    Parameters
    ----------
    keyword_count:
        Number of keywords attached to the item (``len(keyword_names)``).
    context_count:
        Number of contexts the item is valid for (``len(context_names)``).
    description_length:
        Character length of the item description (``len(description)``).
    rating_average:
        Average user rating on a 0-5 scale.  Defaults to ``0.66`` when no
        rating is available — this matches the legacy default.

    Returns
    -------
    int
        An integer in ``[82, 98]`` representing the match percent.
    """
    keyword_score = min(max(keyword_count, 0), 12) / 12
    # Inverse-context specificity: items valid for fewer contexts score higher,
    # capped at 0.35 contexts (≈ 2.86 contexts) to avoid division blow-up.
    specificity_score = min(1 / max(context_count, 1), 0.35) / 0.35
    description_score = min(max(description_length, 0), 260) / 260
    rating_score = (rating_average / 5.0) if rating_average else 0.66

    score = (
        0.74
        + 0.10 * keyword_score
        + 0.07 * specificity_score
        + 0.05 * description_score
        + 0.04 * rating_score
    )
    return int(round(max(82, min(score * 100, 98))))


def suitability_label(match_percent: int) -> str:
    """Return the Thai suitability label for a match-percent value.

    Thresholds (matching legacy):
        >= 92 → ``"เหมาะมาก"`` (very suitable)
        >= 87 → ``"เหมาะสม"`` (suitable)
        else  → ``"เหมาะใช้ได้"`` (fairly suitable)
    """
    if match_percent >= 92:
        return "เหมาะมาก"
    if match_percent >= 87:
        return "เหมาะสม"
    return "เหมาะใช้ได้"