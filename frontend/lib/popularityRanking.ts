import type { EngagementOut, ItemOut } from "@/lib/types";

export function toEngagementMap(rows: EngagementOut[]): Map<number, EngagementOut> {
  const map = new Map<number, EngagementOut>();
  for (const row of rows) map.set(row.item_id, row);
  return map;
}

/** Shared ranking used by both /popular and the admin dashboard. */
export function rankPopularItems(
  items: ItemOut[],
  engagement: Map<number, EngagementOut>,
  limit: number,
): ItemOut[] {
  const scoreFor = (id: number): number => engagement.get(id)?.engagement_score ?? 0;
  const ratingFor = (id: number): number => engagement.get(id)?.rating_count ?? 0;

  return [...items]
    .filter((item) => scoreFor(item.id) > 0)
    .sort((a, b) => {
      const scoreDelta = scoreFor(b.id) - scoreFor(a.id);
      if (scoreDelta !== 0) return scoreDelta;
      const ratingDelta = ratingFor(b.id) - ratingFor(a.id);
      if (ratingDelta !== 0) return ratingDelta;
      const matchDelta = (b.match_percent ?? 0) - (a.match_percent ?? 0);
      if (matchDelta !== 0) return matchDelta;
      return b.id - a.id;
    })
    .slice(0, limit);
}
