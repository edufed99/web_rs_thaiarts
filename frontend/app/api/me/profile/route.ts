import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDataSource } from "@/db/connection";
import { MemberProfileEntity } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { authenticatedJsonMutation, isResponse, requireUser } from "@/lib/server/member-route";
import { ensureProfile } from "@/lib/server/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) { const user = await requireUser(request); return isResponse(user) ? user : NextResponse.json(await ensureProfile(user)); }
// fallow-ignore-next-line complexity -- Field allow-listing and bounded normalization enforce profile authorization.
export async function PATCH(request: NextRequest) {
  const authenticated = await authenticatedJsonMutation(request); if (authenticated instanceof Response) return authenticated;
  const { user, body } = authenticated;
  if (Object.keys(body).some((key) => !["display_name", "avatar_url", "bio", "withdraw_consent", "accept_consent"].includes(key))) return apiError(422, "validation_error", "Only member profile fields may be changed.");
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(MemberProfileEntity);
  const profile = await repo.findOneBy({ userId: Number(user.id) });
  if (!profile) await ensureProfile(user);
  const current = await repo.findOneByOrFail({ userId: Number(user.id) });
  if (typeof body.display_name === "string") current.displayName = body.display_name.trim().slice(0, 120);
  if (typeof body.avatar_url === "string") current.avatarUrl = body.avatar_url.trim().slice(0, 1000);
  if (typeof body.bio === "string") current.bio = body.bio.trim().slice(0, 1000);
  if (body.withdraw_consent === true) {
    current.consentAccepted = false;
    current.consentWithdrawnAt = new Date();
  }
  if (body.accept_consent === true) {
    current.consentAccepted = true;
    current.consentVersion = "v1.0";
    current.consentAcceptedAt = new Date();
    current.consentWithdrawnAt = null;
  }
  await repo.save(current);
  return NextResponse.json(await ensureProfile(user));
}
