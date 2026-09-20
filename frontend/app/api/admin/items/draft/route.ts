import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { adminJsonMutation } from "@/lib/server/admin-route";
import { AdminItemError, createItemDraft } from "@/lib/server/admin-items";
import { itemMutationError } from "@/lib/server/admin-items-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Layer A grounding draft (issue #8). Ports the legacy
 * ``POST /admin/items/draft``: rule-based keyword proposals from the
 * live keyword vocabulary plus context resolution. Layer B (LLM
 * suggestions) is not ported — it was optional in the legacy service.
 */
// fallow-ignore-next-line complexity -- Body field coercion and grounding outcomes share one admin boundary.
export async function POST(request: NextRequest): Promise<Response> {
  const authenticated = await adminJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { body } = authenticated;
  try {
    const result = await createItemDraft({
      name: typeof body.name === "string" ? body.name : "",
      name_en: typeof body.name_en === "string" ? body.name_en : undefined,
      description: typeof body.description === "string" ? body.description : "",
      description_en: typeof body.description_en === "string" ? body.description_en : undefined,
      category_group: typeof body.category_group === "string" ? body.category_group : "",
      category_group_en: typeof body.category_group_en === "string" ? body.category_group_en : undefined,
      performance_type: typeof body.performance_type === "string" ? body.performance_type : "",
      performance_type_en: typeof body.performance_type_en === "string" ? body.performance_type_en : undefined,
      performers_count: body.performers_count === undefined || body.performers_count === null ? null : Number(body.performers_count),
      duration_minutes: body.duration_minutes === undefined || body.duration_minutes === null ? null : Number(body.duration_minutes),
      price_text: typeof body.price_text === "string" ? body.price_text : "",
      context_names: Array.isArray(body.context_names) ? (body.context_names as unknown[]).filter((value): value is string => typeof value === "string") : [],
      keyword_names: Array.isArray(body.keyword_names) ? (body.keyword_names as unknown[]).filter((value): value is string => typeof value === "string") : [],
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminItemError) {
      return itemMutationError(error);
    }
    throw error;
  }
}
