// useCoverImage — the self-contained cover-image unit for AdminItemForm.
// Extracted from ``AdminItemForm.tsx`` (issue #38, ADR-0004 / T11). Owns
// the preview object-URL + per-field validation state, the change
// handler, the post-commit uploader, and the client-side allow-list /
// size cap. The picked ``File`` itself remains in the form's draft-field
// state (single source of truth) and is threaded in here so the save flow
// is unchanged.
import React, { useEffect, useState } from "react";
import { ApiClientError, uploadItemImage } from "@/lib/api";
// Client-side pre-check mirrors the backend allow-list + cap. Showing
// the error here gives the admin instant feedback before the form
// submits — the backend will re-validate.
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGE_LABEL = "5 MB";
export interface UseCoverImageArgs {
  /** Current picked cover file (held in the form's draft-field state). */
  imageFile: File | null;
  /** Writes the picked file back into the form's draft-field state. */
  setImageFile: (file: File | null) => void;
  /** Clears the form-level submit error when a new file is chosen. */
  onClearError: () => void;
}
export interface UseCoverImageReturn {
  imagePreviewUrl: string | null;
  imageError: string | null;
  handleImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadCoverIfAny: (artifactId: number) => Promise<void>;
  allowedImageMime: readonly string[];
  maxImageBytes: number;
  maxImageLabel: string;
}
export function useCoverImage({
  imageFile,
  setImageFile,
  onClearError,
}: UseCoverImageArgs): UseCoverImageReturn {
  // Cover-image preview (object URL) + per-field validation message.
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Release object URLs when the form unmounts (or the user picks a new
  // file) so the browser doesn't leak the preview image.
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);
  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null;
    onClearError();
    setImageError(null);
    // Clear any existing preview before allocating a new object URL.
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
    if (!next) {
      setImageFile(null);
      return;
    }
    if (!ALLOWED_IMAGE_MIME.includes(next.type as (typeof ALLOWED_IMAGE_MIME)[number])) {
      setImageError("รองรับเฉพาะไฟล์รูปภาพ JPEG, PNG หรือ WebP เท่านั้น");
      setImageFile(null);
      // Allow the admin to pick again after seeing the error.
      e.target.value = "";
      return;
    }
    if (next.size > MAX_IMAGE_BYTES) {
      setImageError(`ไฟล์ใหญ่เกินไป — สูงสุด ${MAX_IMAGE_LABEL}`);
      setImageFile(null);
      e.target.value = "";
      return;
    }
    setImagePreviewUrl(URL.createObjectURL(next));
    setImageFile(next);
  }
  /**
   * Upload the picked cover image (if any) to the freshly-committed
   * item. Runs after the JSON draft/commit succeeds so we have a real
   * ``artifact_id`` to attach the file to. Failures are surfaced as
   * inline errors but never block the redirect — the catalog row
   * exists either way; the admin can re-upload from the edit page.
   */
  async function uploadCoverIfAny(artifactId: number): Promise<void> {
    if (!imageFile) return;
    try {
      await uploadItemImage(artifactId, imageFile);
    } catch (e) {
      // Don't throw — the item is already created. Show the message so
      // the admin knows to re-attach the image via the edit page.
      const msg =
        e instanceof ApiClientError
          ? `อัปโหลดรูปไม่สำเร็จ: ${e.message}`
          : "อัปโหลดรูปไม่สำเร็จ";
      // eslint-disable-next-line no-alert
      window.alert(msg);
    }
  }
  return {
    imagePreviewUrl,
    imageError,
    handleImageChange,
    uploadCoverIfAny,
    allowedImageMime: ALLOWED_IMAGE_MIME,
    maxImageBytes: MAX_IMAGE_BYTES,
    maxImageLabel: MAX_IMAGE_LABEL,
  };
}
