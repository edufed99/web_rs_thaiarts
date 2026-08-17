import type { NextRequest } from "next/server"; import { memberReadRoute } from "@/lib/server/member-read-route";
export const runtime = "nodejs"; export function GET(request: NextRequest) { return memberReadRoute(request, "history"); }
