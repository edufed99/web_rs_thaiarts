// Local-member resolution for Google identities (issue #6).
//
// Ports ``user_query.resolve_google_identity``: find by Google subject id,
// safely link an existing unique email (so recommendation history stays
// attached), or create a fresh ordinary member. Google-created accounts are
// never bootstrap admins.
import { randomBytes } from "node:crypto";
import { getDataSource } from "@/db/connection";
import {
  ApplicationUserEntity,
  MemberProfileEntity,
  type ApplicationUser,
  type MemberProfile,
} from "@/db/entities/Members";

export class AmbiguousGoogleEmailError extends Error {}

interface GoogleIdentity {
  subjectId: string;
  email: string;
  displayName: string;
  avatarUrl: string;
}

// fallow-ignore-next-line complexity -- Local-part sanitization and suffix probing must stay in one uniqueness boundary.
function availableGoogleUsername(users: ApplicationUser[], email: string): string {
  const local = (email.split("@", 1)[0] || "google_user").toLowerCase();
  const cleaned = local.replace(/[^a-z0-9_.-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  const base = cleaned || "google_user";
  const minimum = base.length < 3 ? `google_${base}` : base;
  const root = minimum.slice(0, 55);
  const taken = new Set(users.map((user) => user.username));
  if (!taken.has(root)) return root;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${root}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}_${Date.now().toString(36)}`;
}

async function ensureProfileForUser(user: ApplicationUser): Promise<MemberProfile> {
  const dataSource = await getDataSource();
  let profile = await dataSource.getRepository(MemberProfileEntity).findOneBy({ userId: Number(user.id) });
  if (!profile) {
    const role = user.isAdmin ? "super_admin" : "user";
    profile = await dataSource.getRepository(MemberProfileEntity).save({
      userId: Number(user.id),
      displayName: user.displayName || user.username,
      role,
      userGroup: role,
    });
  }
  return profile;
}

/** Adopt an identity onto an existing member (subject match or email link). */
async function adoptIdentity(user: ApplicationUser, identity: GoogleIdentity): Promise<ApplicationUser> {
  const dataSource = await getDataSource();
  user.emailVerified = true;
  await dataSource.getRepository(ApplicationUserEntity).save(user);
  const profile = await ensureProfileForUser(user);
  if (identity.avatarUrl && !profile.avatarUrl) {
    profile.avatarUrl = identity.avatarUrl.trim();
    await dataSource.getRepository(MemberProfileEntity).save(profile);
  }
  return user;
}

/**
 * Find, safely link, or create the local account for a Google identity.
 * Returns the member plus the linkage kind. Throws AmbiguousGoogleEmailError
 * when the email maps to multiple local accounts or another Google identity.
 */
// fallow-ignore-next-line complexity -- Subject match, email link, and create branches are one atomic identity boundary.
export async function resolveGoogleIdentity(
  identity: GoogleIdentity,
): Promise<{ user: ApplicationUser; kind: "existing" | "linked" | "created" }> {
  const dataSource = await getDataSource();
  const subject = identity.subjectId.trim();
  const normalizedEmail = identity.email.trim().toLowerCase();
  if (!subject || !normalizedEmail) throw new AmbiguousGoogleEmailError("Google identity is missing required fields");

  const existingSubject = await dataSource.getRepository(ApplicationUserEntity).findOneBy({ googleSubjectId: subject });
  if (existingSubject) return { user: await adoptIdentity(existingSubject, identity), kind: "existing" };

  const emailMatches = await dataSource.getRepository(ApplicationUserEntity)
    .createQueryBuilder("user")
    .where("LOWER(user.email) = :email", { email: normalizedEmail })
    .getMany();
  if (emailMatches.length > 1) {
    throw new AmbiguousGoogleEmailError("This email is shared by multiple local accounts");
  }
  if (emailMatches.length === 1) {
    const user = emailMatches[0];
    if (user.googleSubjectId && user.googleSubjectId !== subject) {
      throw new AmbiguousGoogleEmailError("This email is already linked to another Google identity");
    }
    user.googleSubjectId = subject;
    user.authProvider = "password+google";
    return { user: await adoptIdentity(user, identity), kind: "linked" };
  }

  const allUsers = await dataSource.getRepository(ApplicationUserEntity).find();
  const username = availableGoogleUsername(allUsers, normalizedEmail);
  const name = identity.displayName.trim() || username;
  const user = await dataSource.getRepository(ApplicationUserEntity).save({
    username,
    email: normalizedEmail,
    passwordHash: `!google:${randomBytes(32).toString("base64url")}`,
    googleSubjectId: subject,
    authProvider: "google",
    emailVerified: true,
    displayName: name,
    isAdmin: false,
  });
  await dataSource.getRepository(MemberProfileEntity).save({
    userId: Number(user.id),
    displayName: name,
    avatarUrl: identity.avatarUrl.trim(),
    role: "user",
    userGroup: "user",
  });
  return { user, kind: "created" };
}
