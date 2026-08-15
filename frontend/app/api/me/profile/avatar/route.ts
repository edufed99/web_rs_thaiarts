import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { MemberProfileEntity } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { csrfFailure, isResponse, requireUser } from "@/lib/server/member-route";
import { ensureProfile } from "@/lib/server/members";

export const runtime = "nodejs";
const extensions = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);

// fallow-ignore-next-line complexity -- Upload authorization, MIME/size checks, path safety, and persistence are one boundary.
export async function POST(request: NextRequest): Promise<Response> {
  const csrf = csrfFailure(request); if (csrf) return csrf;
  const user = await requireUser(request); if (isResponse(user)) return user;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !extensions.has(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) return apiError(422, "invalid_upload", "Avatar must be a JPEG, PNG, or WebP file no larger than 5 MB.");
  const root = resolve(process.env.MEDIA_STORE_ROOT || resolve(process.cwd(), "data", "uploads"));
  const directory = resolve(root, "avatars");
  if (!directory.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) return apiError(500, "unsafe_media_path", "Media path is not allowed.");
  await mkdir(directory, { recursive: true });
  const filename = `user-${Number(user.id)}-${randomUUID()}${extensions.get(file.type)}`;
  await writeFile(resolve(directory, filename), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  await updateAvatar(Number(user.id), `/api/uploads/avatars/${filename}`);
  return NextResponse.json(await ensureProfile(user));
}

// fallow-ignore-next-line complexity -- Authorized state removal and bounded best-effort file cleanup are intentionally explicit.
export async function DELETE(request: NextRequest): Promise<Response> {
  const csrf = csrfFailure(request); if (csrf) return csrf;
  const user = await requireUser(request); if (isResponse(user)) return user;
  const oldUrl = await updateAvatar(Number(user.id), "");
  if (oldUrl.startsWith("/api/uploads/avatars/")) {
    const root = resolve(process.env.MEDIA_STORE_ROOT || resolve(process.cwd(), "data", "uploads"));
    const filename = oldUrl.slice("/api/uploads/avatars/".length);
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) && extname(filename)) await unlink(resolve(root, "avatars", filename)).catch(() => undefined);
  }
  return NextResponse.json(await ensureProfile(user));
}

async function updateAvatar(userId: number, avatarUrl: string): Promise<string> {
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(MemberProfileEntity);
  let profile = await repo.findOneBy({ userId });
  if (!profile) throw new Error("Member profile missing");
  const old = profile.avatarUrl;
  profile.avatarUrl = avatarUrl;
  profile = await repo.save(profile);
  return old;
}
