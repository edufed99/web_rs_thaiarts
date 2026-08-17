import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { CatalogueItemEntity } from "@/db/entities/Catalogue";
import { apiError } from "@/lib/server/api-response";
import { requireAdmin, isAdminResponse } from "@/lib/server/admin-route";
import { csrfFailure } from "@/lib/server/member-route";
import { MediaStoreError, deleteUpload, saveItemVideo } from "@/lib/server/media-store";
import { markItemsUnpublished } from "@/lib/server/publication";
import { integerInRange } from "@/lib/server/request-values";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface VideoRouteContext {
  params: { id: string };
}

/**
 * Video upload for a catalogue item (issue #8). Parity with the legacy
 * ``POST /admin/items/{artifact_id}/video``: magic-byte sniffing
 * (MP4/WebM/MOV, max 100 MB), artifact-id filename prefix, old upload
 * removed best-effort after the DB write.
 */
// fallow-ignore-next-line complexity -- Upload authorization, sniffing, DB update, and old-file cleanup are one boundary.
export async function POST(request: NextRequest, context: VideoRouteContext): Promise<Response> {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const admin = await requireAdmin(request);
  if (isAdminResponse(admin)) return admin;
  const artifactId = integerInRange(context.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (artifactId === undefined) {
    return apiError(422, "validation_error", "path.id: Input should be a valid integer");
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return apiError(400, "video_invalid_type", "Video type not supported (allowed: MP4, WebM, MOV).");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  let stored: { url: string; size_bytes: number; mime: string };
  try {
    stored = await saveItemVideo(bytes, artifactId);
  } catch (error) {
    if (error instanceof MediaStoreError) {
      return apiError(error.status, error.code, error.message);
    }
    return apiError(500, "internal_server_error", "The server could not complete this request.");
  }
  const dataSource = await getDataSource();
  try {
    const oldUrl = await dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CatalogueItemEntity);
      const item = await repo.findOneBy({ artifactItemId: artifactId });
      if (!item) {
        throw new MediaStoreError(404, "item_not_found", `Item id ${artifactId} not found.`);
      }
      const previous = item.videoUrl;
      item.videoUrl = stored.url;
      await repo.save(item);
      await markItemsUnpublished(manager, [Number(item.id)]);
      return previous;
    });
    await deleteUpload(oldUrl);
  } catch (error) {
    if (error instanceof MediaStoreError) {
      return apiError(error.status, error.code, error.message);
    }
    return apiError(500, "internal_server_error", "The server could not complete this request.");
  }
  return NextResponse.json({ url: stored.url, size_bytes: stored.size_bytes, mime: stored.mime, item_id: artifactId });
}
