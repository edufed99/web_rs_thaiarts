import type { NextRequest } from "next/server";
import { actionRoute } from "@/lib/server/action-route";
export const runtime = "nodejs";
export function POST(request: NextRequest) { return actionRoute(request, "view"); }
