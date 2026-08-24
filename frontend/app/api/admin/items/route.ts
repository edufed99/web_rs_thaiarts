import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { adminJsonMutation } from "@/lib/server/admin-route";
import { commitItemDraft } from "@/lib/server/admin-items";
import { itemMutationCaughtError } from "@/lib/server/admin-items-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Layer C commit (issue #8): create a catalogue item from a grounded
 * draft. The artifact item identifier is derived once from the name and
 * is immutable afterwards; the new row is immediately browsable but
 * stays unavailable to personalized scoring until an explicit Artifact
 * Publication succeeds.
 */
// fallow-ignore-next-line complexity -- Draft consumption and keyword merge stay one admin boundary.
export async function POST(request: NextRequest): Promise<Response> {
  const authenticated = await adminJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { admin, body } = authenticated;
  try {
    const draftId = typeof body.draft_id === "string" ? body.draft_id : "";
    const additional = Array.isArray(body.additional_keyword_ids)
      ? (body.additional_keyword_ids as unknown[]).map((value) => Number(value))
      : [];
    const removed = Array.isArray(body.removed_keyword_ids)
      ? (body.removed_keyword_ids as unknown[]).map((value) => Number(value))
      : [];
    const newKeywords = Array.isArray(body.new_keywords)
      ? (body.new_keywords as { name?: string; taxonomy_path?: string }[])
          .filter((k) => typeof k?.name === "string" && k.name.trim().length > 0)
          .map((k) => ({
            name: k.name!.trim(),
            taxonomy_path: typeof k.taxonomy_path === "string" ? k.taxonomy_path.trim() : undefined,
          }))
      : [];
    return NextResponse.json(
      await commitItemDraft(admin, {
        draft_id: draftId,
        additional_keyword_ids: additional,
        removed_keyword_ids: removed,
        new_keywords: newKeywords,
      }),
    );
  } catch (error) {
    return itemMutationCaughtError(error);
  }
}
