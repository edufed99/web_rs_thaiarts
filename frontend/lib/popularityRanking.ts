import type { EngagementOut, ItemOut, LegacyStatsOut } from "@/lib/types";

export function toEngagementMap(rows: EngagementOut[]): Map<number, EngagementOut> {
  const map = new Map<number, EngagementOut>();
  for (const row of rows) map.set(row.item_id, row);
  return map;
}

/**
 * Popular = items with live engagement (likes + saves + positive ratings),
 * ranked by engagement score descending. Tie-breakers: avg_rating desc,
 * total review count desc, catalog match_percent desc, then stable id desc.
 *
 * Quality gate: items that have received at least one review must have an
 * avg_rating >= 3 to qualify. Items with no reviews yet (avg_rating === 0)
 * are still eligible — only confirmed low-rated items are excluded.
 */
export function rankPopularItems(
  items: ItemOut[],
  engagement: Map<number, EngagementOut>,
  legacy: Map<number, LegacyStatsOut>,
  limit: number,
): ItemOut[] {
  const scoreFor = (id: number): number => engagement.get(id)?.engagement_score ?? 0;
  const positiveRatingsFor = (id: number): number => engagement.get(id)?.rating_count ?? 0;
  const avgFor = (id: number): number => legacy.get(id)?.avg_rating ?? 0;
  const reviewCountFor = (id: number): number => legacy.get(id)?.count ?? 0;

  return [...items]
    .filter((item) => scoreFor(item.id) > 0 && (avgFor(item.id) === 0 || avgFor(item.id) >= 3))
    .sort((a, b) => {
      const scoreDelta = scoreFor(b.id) - scoreFor(a.id);
      if (scoreDelta !== 0) return scoreDelta;
      const avgDelta = avgFor(b.id) - avgFor(a.id);
      if (avgDelta !== 0) return avgDelta;
      const reviewDelta = reviewCountFor(b.id) - reviewCountFor(a.id);
      if (reviewDelta !== 0) return reviewDelta;
      const positiveDelta = positiveRatingsFor(b.id) - positiveRatingsFor(a.id);
      if (positiveDelta !== 0) return positiveDelta;
      const matchDelta = (b.match_percent ?? 0) - (a.match_percent ?? 0);
      if (matchDelta !== 0) return matchDelta;
      return b.id - a.id;
    })
    .slice(0, limit);
}

/**
 * Top Rated = items with at least one review and avg_rating > 0,
 * ranked by average rating descending. Tie-breakers: total review count desc,
 * catalog match_percent desc, then stable id desc.
 *
 * When `engagement` is supplied, the item must also have received at least one
 * rating inside that engagement window (e.g. last 7 or 30 days). This lets the
 * "top rated" page mirror the popular page's weekly/monthly split without
 * needing a separate period-scoped average-rating endpoint.
 */
export function rankTopRatedItems(
  items: ItemOut[],
  legacy: Map<number, LegacyStatsOut>,
  limit: number,
  engagement?: Map<number, EngagementOut>,
): ItemOut[] {
  const avgFor = (id: number): number => legacy.get(id)?.avg_rating ?? 0;
  const reviewCountFor = (id: number): number => legacy.get(id)?.count ?? 0;
  const periodRatingsFor = (id: number): number => engagement?.get(id)?.rating_count ?? 0;

  return [...items]
    .filter((item) => avgFor(item.id) > 0 && (!engagement || periodRatingsFor(item.id) > 0))
    .sort((a, b) => {
      const avgDelta = avgFor(b.id) - avgFor(a.id);
      if (avgDelta !== 0) return avgDelta;
      const reviewDelta = reviewCountFor(b.id) - reviewCountFor(a.id);
      if (reviewDelta !== 0) return reviewDelta;
      const matchDelta = (b.match_percent ?? 0) - (a.match_percent ?? 0);
      if (matchDelta !== 0) return matchDelta;
      return b.id - a.id;
    })
    .slice(0, limit);
}
