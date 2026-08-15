import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { ApplicationUserEntity, MemberProfileEntity } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { userOut } from "@/lib/server/sessions";

/**
 * Admin user-management service (issue #8). Behavioural parity with the
 * legacy FastAPI ``/admin/users`` routes: list, create (bcrypt password),
 * update (with self-demotion guard), delete (with self-delete guard).
 * Error codes mirror the legacy contract so the admin UI keeps mapping
 * them to Thai messages.
 */

class AdminUserError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminUserError";
    this.status = status;
    this.code = code;
  }
}

/** Normalize user-management failures into the stable error contract. */
// fallow-ignore-next-line complexity -- Error codes are normalized without exposing internals.
export function adminUserError(error: unknown): NextResponse {
  if (error instanceof AdminUserError) {
    return apiError(error.status, error.code, error.message);
  }
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "23505") {
    return apiError(409, "duplicate_username", "Username already taken.");
  }
  return apiError(500, "internal_server_error", "The server could not complete this request.");
}

export async function listAdminUsers(): Promise<{ users: ReturnType<typeof userOut>[]; total: number }> {
  const dataSource = await getDataSource();
  const rows = await dataSource.getRepository(ApplicationUserEntity).find({
    order: { id: "ASC" },
    take: 500,
  });
  const users = rows.map((row) => userOut(row));
  return { users, total: users.length };
}

// fallow-ignore-next-line complexity -- Per-field validation, uniqueness, and profile creation share one transaction.
export async function createAdminUser(input: {
  username: string;
  email?: string | null;
  password: string;
  display_name?: string | null;
  is_admin: boolean;
}): Promise<ReturnType<typeof userOut>> {
  const username = (input.username ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const displayName = (input.display_name ?? "").trim();
  if (username.length < 3 || username.length > 64) {
    throw new AdminUserError(422, "validation_error", "Invalid username.");
  }
  if (typeof input.password !== "string" || input.password.length < 8 || input.password.length > 128) {
    throw new AdminUserError(422, "validation_error", "Invalid password.");
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AdminUserError(422, "validation_error", "Invalid email.");
  }
  const dataSource = await getDataSource();
  const existing = await dataSource.getRepository(ApplicationUserEntity).findOneBy({ username });
  if (existing) {
    throw new AdminUserError(409, "duplicate_username", "Username already taken.");
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  // fallow-ignore-next-line complexity -- Atomic user + profile creation mirrors the signup boundary.
  const saved = await dataSource.transaction(async (manager) => {
    const user = await manager.getRepository(ApplicationUserEntity).save({
      username,
      email,
      passwordHash,
      displayName: displayName || username,
      isAdmin: Boolean(input.is_admin),
      authProvider: "password",
      emailVerified: false,
    });
    await manager.getRepository(MemberProfileEntity).save({
      userId: Number(user.id),
      displayName: displayName || username,
      role: user.isAdmin ? "super_admin" : "user",
      userGroup: user.isAdmin ? "super_admin" : "user",
    });
    return user;
  });
  return userOut(saved);
}

// fallow-ignore-next-line complexity -- Per-field validation, demotion guard, and uniqueness checks are one parity boundary.
export async function updateAdminUser(
  targetUserId: number,
  adminId: number,
  input: {
    username?: string | null;
    email?: string | null;
    display_name?: string | null;
    password?: string | null;
    is_admin?: boolean | null;
  },
): Promise<ReturnType<typeof userOut>> {
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(ApplicationUserEntity);
  const target = await repo.findOneBy({ id: targetUserId });
  if (!target) {
    throw new AdminUserError(404, "user_not_found", "User not found.");
  }
  if (input.is_admin === false && Number(adminId) === Number(targetUserId)) {
    throw new AdminUserError(400, "cannot_demote_self", "You cannot remove your own administrator role.");
  }
  if (typeof input.username === "string" && input.username.trim() !== target.username) {
    const duplicate = await repo.findOneBy({ username: input.username.trim() });
    if (duplicate && Number(duplicate.id) !== Number(targetUserId)) {
      throw new AdminUserError(409, "duplicate_username", "Username already taken.");
    }
    target.username = input.username.trim();
  }
  if (typeof input.email === "string") {
    const email = input.email.trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new AdminUserError(422, "validation_error", "Invalid email.");
    }
    target.email = email;
  }
  if (typeof input.display_name === "string") {
    target.displayName = input.display_name.trim().slice(0, 120);
  }
  if (typeof input.password === "string" && input.password.length > 0) {
    if (input.password.length < 8 || input.password.length > 128) {
      throw new AdminUserError(422, "validation_error", "Invalid password.");
    }
    target.passwordHash = await bcrypt.hash(input.password, 12);
  }
  if (typeof input.is_admin === "boolean") {
    target.isAdmin = input.is_admin;
  }
  const updated = await repo.save(target);
  await dataSource.getRepository(MemberProfileEntity).update(
    { userId: Number(targetUserId) },
    { role: updated.isAdmin ? "super_admin" : "user", userGroup: updated.isAdmin ? "super_admin" : "user" },
  );
  return userOut(updated);
}

export async function deleteAdminUser(targetUserId: number, adminId: number): Promise<{ deleted: boolean; user_id: number }> {
  if (Number(adminId) === Number(targetUserId)) {
    throw new AdminUserError(400, "cannot_delete_self", "You cannot delete the account you are currently using.");
  }
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(ApplicationUserEntity);
  const target = await repo.findOneBy({ id: targetUserId });
  if (!target) {
    throw new AdminUserError(404, "user_not_found", "User not found.");
  }
  await dataSource.transaction(async (manager) => {
    await manager.getRepository(MemberProfileEntity).delete({ userId: Number(targetUserId) });
    await manager.getRepository(ApplicationUserEntity).delete({ id: Number(targetUserId) });
  });
  return { deleted: true, user_id: Number(targetUserId) };
}
