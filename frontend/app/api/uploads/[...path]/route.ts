import { createReadStream } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { Readable } from "node:stream";

import type { NextRequest } from "next/server";

import { apiError, internalApiError } from "@/lib/server/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const publicDirectories = new Set(["items", "avatars"]);
const contentTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

// fallow-ignore-next-line complexity -- Security checks and HTTP range branches are explicit at the public file boundary.
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } },
): Promise<Response> {
  const safePath = validatedMediaPath(params.path);
  if (!safePath) return apiError(400, "unsafe_media_path", "Media path is not allowed.");

  const root = resolve(
    process.env.MEDIA_STORE_ROOT || resolve(process.cwd(), "data", "uploads"),
  );
  const candidate = resolve(root, ...safePath);
  if (!isWithin(root, candidate)) {
    return apiError(400, "unsafe_media_path", "Media path is not allowed.");
  }

  try {
    const [rootRealPath, candidateRealPath] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
    if (!isWithin(rootRealPath, candidateRealPath)) {
      return apiError(400, "unsafe_media_path", "Media path is not allowed.");
    }
    const metadata = await stat(candidateRealPath);
    if (!metadata.isFile()) {
      return apiError(404, "media_not_found", "Media file not found.");
    }
    const extension = extname(candidateRealPath).toLocaleLowerCase();
    const contentType = contentTypes[extension];
    if (!contentType) {
      return apiError(404, "media_not_found", "Media file not found.");
    }
    const range = parseRange(request.headers.get("range"), metadata.size);
    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${metadata.size}` },
      });
    }
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    if (range) {
      const body = createReadStream(candidateRealPath, range);
      headers.set("Content-Length", String(range.end - range.start + 1));
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${metadata.size}`);
      return new Response(Readable.toWeb(body) as ReadableStream, { status: 206, headers });
    }
    headers.set("Content-Length", String(metadata.size));
    return new Response(
      Readable.toWeb(createReadStream(candidateRealPath)) as ReadableStream,
      { status: 200, headers },
    );
  } catch (error) {
    if (isMissingFile(error)) {
      return apiError(404, "media_not_found", "Media file not found.");
    }
    return internalApiError();
  }
}

// fallow-ignore-next-line complexity -- Every rejection clause documents a distinct unsafe-path condition.
function validatedMediaPath(path: string[]): [string, string] | undefined {
  if (path.length !== 2) return undefined;
  const decoded = path.map(decodeRepeatedly);
  const [directory, filename] = decoded;
  if (
    !directory ||
    !filename ||
    !publicDirectories.has(directory) ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) ||
    !contentTypes[extname(filename).toLocaleLowerCase()]
  ) {
    return undefined;
  }
  return [directory, filename];
}

function decodeRepeatedly(value: string): string {
  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return "";
    }
  }
  return decoded;
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(normalizedRoot);
}

// fallow-ignore-next-line complexity -- RFC byte-range validation requires mutually exclusive range forms and bounds checks.
function parseRange(
  raw: string | null,
  size: number,
): { start: number; end: number } | null | undefined {
  if (!raw) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if (!match || size <= 0) return null;
  let start: number;
  let end: number;
  if (match[1]) {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  } else if (match[2]) {
    const suffixLength = Number(match[2]);
    if (suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    return null;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

function isMissingFile(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
