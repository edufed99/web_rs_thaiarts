// AdminItemForm data model + pure helpers.
// Extracted from ``AdminItemForm.tsx`` (issue #38, ADR-0004 / T11) so the
// draft-field shape, the empty-state default, and the submit-path helpers
// are independently importable and testable. Behaviour is unchanged.
import type { ItemDraft } from "@/lib/types";
export interface DraftFields {
  name: string;
  name_en: string;
  description: string;
  description_en: string;
  category_group: string;
  category_group_en: string;
  performance_type: string;
  performance_type_en: string;
  performers_count: string;
  duration_minutes: string;
  price_text: string;
  context_names: string[];
  keyword_names: string[];
  /**
   * Picked cover image (client-side only). Held in state until the new
   * item is committed; we then POST it to ``/admin/items/{id}/image``
   * before redirecting. Not sent in the draft/commit JSON payload.
   */
  image_file: File | null;
}
export const EMPTY_FIELDS: DraftFields = {
  name: "",
  name_en: "",
  description: "",
  description_en: "",
  category_group: "",
  category_group_en: "",
  performance_type: "",
  performance_type_en: "",
  performers_count: "",
  duration_minutes: "",
  price_text: "",
  context_names: [],
  keyword_names: [],
  image_file: null,
};
/**
 * Parse a numeric form field into ``int | null``. Empty strings, NaN, and
 * negative numbers all collapse to ``null`` so the backend gets a typed
 * optional rather than ``0``.
 */
export function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}
/**
 * Map the form's draft field state into an ``ItemDraft`` POST body. Shared
 * by both submit paths (``ดูคำสำคัญที่เสนอ`` → review, and ``บันทึกข้อมูล``
 * → direct commit) so they never drift apart.
 */
export function buildDraftBody(fields: DraftFields): ItemDraft {
  return {
    name: fields.name.trim(),
    name_en: fields.name_en.trim() || undefined,
    description: fields.description.trim(),
    description_en: fields.description_en.trim() || undefined,
    category_group: fields.category_group.trim(),
    category_group_en: fields.category_group_en.trim() || undefined,
    performance_type: fields.performance_type.trim(),
    performance_type_en: fields.performance_type_en.trim() || undefined,
    performers_count: parseCount(fields.performers_count),
    duration_minutes: parseCount(fields.duration_minutes),
    price_text: fields.price_text.trim(),
    context_names: fields.context_names
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    keyword_names: fields.keyword_names
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}
/** The "บันทึกข้อมูล" shortcut needs at least a name to make sense. */
export function canSave(fields: DraftFields): boolean {
  return fields.name.trim().length > 0;
}
