import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { ApplicationUserEntity, MemberProfileEntity } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { jsonError, sameOriginJson } from "@/lib/server/member-route";
import { rotateSession, setSessionCookie, userOut } from "@/lib/server/sessions";

export const runtime = "nodejs";

// fallow-ignore-next-line complexity -- Signup validation, bootstrap-role selection, transaction, and session issuance are one security boundary.
export async function POST(request: NextRequest): Promise<Response> {
  const body = await sameOriginJson(request);
  if (body instanceof Response) return body;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (username.length < 3 || username.length > 64 || password.length < 8 || password.length > 128 || (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    return apiError(422, "validation_error", "Invalid signup fields.");
  }
  try {
    const dataSource = await getDataSource();
    const passwordHash = await bcrypt.hash(password, 12);
    // fallow-ignore-next-line complexity -- Atomic account/profile creation includes the documented bootstrap-admin rule.
    const user = await dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ApplicationUserEntity);
      const configuredAdmins = (process.env.RECSYS_ADMIN_USERNAMES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      // PostgreSQL transaction advisory locks serialize only the no-config
      // bootstrap decision. The count and insert then form one critical
      // section, so concurrent empty-database signups cannot both become admin.
      if (configuredAdmins.length === 0) {
        await manager.query("SELECT pg_advisory_xact_lock($1)", [1786939200]);
      }
      const isAdmin = configuredAdmins.length > 0 ? configuredAdmins.includes(username) : await repo.count() === 0;
      const consentAccepted = Boolean(body.consent_accepted);
      const saved = await repo.save({
        username,
        email,
        passwordHash,
        displayName: displayName || username,
        isAdmin,
        authProvider: "password",
        emailVerified: false,
        consentAccepted,
        consentVersion: consentAccepted ? "v1.0" : "",
        consentAcceptedAt: consentAccepted ? new Date() : null,
        consentWithdrawnAt: null,
      });
      await manager.getRepository(MemberProfileEntity).save({ userId: Number(saved.id), displayName: saved.displayName, role: saved.isAdmin ? "super_admin" : "user", userGroup: saved.isAdmin ? "super_admin" : "user" });
      return saved;
    });
    const token = await rotateSession(Number(user.id));
    const response = NextResponse.json({ expires_in_seconds: 604800, user: userOut(user) });
    setSessionCookie(response, token);
    return response;
  } catch (error) { return jsonError(error); }
}
