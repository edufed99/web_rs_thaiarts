import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isResponse, requireUser } from "@/lib/server/member-route";
import { ensureProfile, history, memberSummary, recentViews } from "@/lib/server/members";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request); if (isResponse(user)) return user;
  const [profile, summary, recent_activity, recent_views] = await Promise.all([ensureProfile(user), memberSummary(user), history(user, 10), recentViews(user, 30, 4)]);
  return NextResponse.json({ profile, summary, recent_activity, recent_views });
}
