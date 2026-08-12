import { getItemsBatch } from "./api";
import type { ItemOut } from "./types";

export async function loadMemberItems(
  ids: number[],
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<ItemOut[]> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  const response = await getItemsBatch(uniqueIds, { userKey, extraHeaders });
  return response.items;
}
