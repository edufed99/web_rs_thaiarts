import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

/**
 * Admin media lifecycle (issue #8). TypeScript port of the legacy
 * ``backend/app/services/storage.py`` boundary: files are validated by
 * magic-byte sniffing (never the client's declared Content-Type),
 * stored under ``MEDIA_STORE_ROOT`` with an artifact-id prefix, and the
 * public URL is returned for the catalogue row. Old uploads are removed
 * best-effort after the DB write so a failed cleanup never leaves the
 * DB pointing at a missing file.
 */

export class MediaStoreError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MediaStoreError";
    this.status = status;
    this.code = code;
  }
}

interface SniffResult {
  mime: string | null;
  extension: string | null;
}

const SNIFF_BYTES = 32;

// fallow-ignore-next-line complexity -- Magic-byte sniffing makes every image signature an explicit branch.
function sniffImageMime(head: Buffer): SniffResult {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: "image/jpeg", extension: ".jpg" };
  }
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { mime: "image/png", extension: ".png" };
  }
  if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
    return { mime: "image/webp", extension: ".webp" };
  }
  return { mime: null, extension: null };
}

// fallow-ignore-next-line complexity -- MP4/WebM/MOV signatures and the QuickTime brands are explicit branches.
function sniffVideoMime(head: Buffer): SniffResult {
  if (head.length >= 12 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = head.subarray(8, 12);
    const isQuickTime =
      brand[0] === 0x71 && brand[1] === 0x74 && brand[2] === 0x20 && brand[3] === 0x20;
    const isLegacyQuickTime =
      brand[0] === 0x71 && brand[1] === 0x74 && brand[2] === 0x00 && brand[3] === 0x00;
    if (isQuickTime || isLegacyQuickTime) {
      return { mime: "video/quicktime", extension: ".mov" };
    }
    return { mime: "video/mp4", extension: ".mp4" };
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return { mime: "video/webm", extension: ".webm" };
  }
  return { mime: null, extension: null };
}

function publicUrl(subdir: string, filename: string): string {
  const safeSubdir = subdir.replace(/[^A-Za-z0-9_-]/g, "") || "items";
  return `/uploads/${safeSubdir}/${filename}`;
}

// fallow-ignore-next-line complexity -- Type sniff, size cap, and path safety are distinct validation clauses.
async function storeFile(
  bytes: Buffer,
  kind: "image" | "video",
  prefix: string,
): Promise<{ url: string; size_bytes: number; mime: string }> {
  const sniff = kind === "image" ? sniffImageMime(bytes) : sniffVideoMime(bytes);
  const allowed = kind === "image"
    ? new Set(["image/jpeg", "image/png", "image/webp"])
    : new Set(["video/mp4", "video/webm", "video/quicktime"]);
  if (!sniff.mime || !sniff.extension || !allowed.has(sniff.mime)) {
    throw new MediaStoreError(
      400,
      kind === "image" ? "image_invalid_type" : "video_invalid_type",
      kind === "image"
        ? "Image type not supported (allowed: JPEG, PNG, WebP)."
        : "Video type not supported (allowed: MP4, WebM, MOV).",
    );
  }
  const maxBytes = kind === "image" ? 5 * 1024 * 1024 : 100 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new MediaStoreError(
      400,
      kind === "image" ? "image_too_large" : "video_too_large",
      kind === "image"
        ? `Image too large (max ${maxBytes / (1024 * 1024)} MB).`
        : `Video too large (max ${maxBytes / (1024 * 1024)} MB).`,
    );
  }
  const root = resolve(process.env.MEDIA_STORE_ROOT || resolve(process.cwd(), "data", "uploads"));
  const directory = resolve(root, "items");
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!directory.startsWith(rootPrefix)) {
    throw new MediaStoreError(500, "unsafe_media_path", "Media path is not allowed.");
  }
  await mkdir(directory, { recursive: true });
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, "") || "file";
  const filename = `${safePrefix}_${randomUUID()}${sniff.extension}`;
  await writeFile(resolve(directory, filename), bytes, { flag: "wx" });
  return { url: publicUrl("items", filename), size_bytes: bytes.length, mime: sniff.mime };
}

export async function saveItemImage(bytes: Buffer, artifactId: number): Promise<{ url: string; size_bytes: number; mime: string }> {
  return storeFile(bytes, "image", String(artifactId));
}

export async function saveItemVideo(bytes: Buffer, artifactId: number): Promise<{ url: string; size_bytes: number; mime: string }> {
  return storeFile(bytes, "video", `${artifactId}_video`);
}

/**
 * Best-effort delete of a previously-uploaded media file. Only removes
 * paths that resolve inside ``MEDIA_STORE_ROOT`` — refuses anything that
 * smells of traversal or a non-upload path.
 */
// fallow-ignore-next-line complexity -- Traversal guards and best-effort delete are explicitly bounded.
export async function deleteUpload(publicUrlPath: string): Promise<boolean> {
  if (!publicUrlPath) return false;
  const prefix = "/uploads/";
  if (!publicUrlPath.startsWith(prefix)) return false;
  const relative = publicUrlPath.slice(prefix.length).replace(/^\/+/, "");
  const root = resolve(process.env.MEDIA_STORE_ROOT || resolve(process.cwd(), "data", "uploads"));
  const target = resolve(root, relative);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(rootPrefix)) return false;
  try {
    await unlink(target);
    return true;
  } catch {
    return false;
  }
}
