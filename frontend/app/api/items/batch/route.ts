import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { internalApiError } from "@/lib/server/api-response";
import { getItemsBatch } from "@/lib/server/catalogue";
import { catalogueCompatibilityResponse } from "@/lib/server/compatibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const compatibility = catalogueCompatibilityResponse(request);
  if (compatibility) return compatibility;
  const ids = parseIds(request.nextUrl.searchParams.get("ids"));
  try {
    return NextResponse.json(await getItemsBatch(ids));
  } catch {
    return internalApiError();
  }
}

function parseIds(raw: string | null): number[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((chunk) => chunk.trim())
        .filter((chunk) => /^\d+$/.test(chunk))
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0),
    ),
  ].slice(0, 200);
}
