import { NextResponse } from "next/server";

import { internalApiError } from "@/lib/server/api-response";
import { listContexts } from "@/lib/server/catalogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({ contexts: await listContexts() });
  } catch {
    return internalApiError();
  }
}
