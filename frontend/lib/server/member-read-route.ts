import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isResponse, requireUser } from "@/lib/server/member-route";
import { artifactIdsFor, history, memberSummary, ratedItems, recentViews } from "@/lib/server/members";

// fallow-ignore-next-line complexity -- A shared authorized GET boundary dispatches the existing member response shapes.
export async function memberReadRoute(request: NextRequest, kind: "liked" | "saved" | "rated" | "summary" | "history" | "recent" | "rating-summary") {
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  if (kind === "liked" || kind === "saved") {
    const items = await artifactIdsFor(user, kind);
    return NextResponse.json({ items, total: items.length });
  }
  if (kind === "rated") {
    const items = await ratedItems(user);
    return NextResponse.json({ items, total: items.length });
  }
  if (kind === "summary") return NextResponse.json(await memberSummary(user));
  if (kind === "history") {
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 20));
    return NextResponse.json(await history(user, limit));
  }
  if (kind === "recent") {
    const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 30));
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 20));
    return NextResponse.json(await recentViews(user, days, limit));
  }
  const items = await ratedItems(user);
  const distribution = [1, 2, 3, 4, 5].map((stars) => ({ stars, count: items.filter((item) => item.rating === stars).length }));
  const average = items.length ? items.reduce((sum, item) => sum + item.rating, 0) / items.length : 0;
  return NextResponse.json({ average, total: items.length, distribution });
}
