// One-time password-reset token lifecycle (issue #6).
//
// Only the SHA-256 hash of the raw token is persisted; the raw token travels
// in the recovery email and is consumed exactly once (or revoked when the
// email could not be delivered). A successful reset revokes every server
// session for the account.
import { createHash, randomBytes } from "node:crypto";
import { getDataSource } from "@/db/connection";
import {
  ApplicationUserEntity,
  MemberProfileEntity,
  PasswordResetTokenEntity,
  type ApplicationUser,
} from "@/db/entities/Members";

const RESEND_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_MARKER = "must_reset|";
const LEGACY_NAME_MARKER = "legacy:";

function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

// fallow-ignore-next-line complexity -- Both legacy markers must be stripped in the documented order.
function stripInternalDisplayMarkers(value: string, fallback: string): string {
  let clean = (value ?? "").trim();
  if (clean.startsWith(PASSWORD_RESET_MARKER)) clean = clean.slice(PASSWORD_RESET_MARKER.length).trim();
  if (clean.startsWith(LEGACY_NAME_MARKER)) clean = clean.slice(LEGACY_NAME_MARKER.length).trim();
  return clean || fallback;
}

/** Find the account only when both recovery identifiers match. */
export async function findUserByUsernameAndEmail(username: string, email: string): Promise<ApplicationUser | null> {
  const dataSource = await getDataSource();
  const users = await dataSource.getRepository(ApplicationUserEntity)
    .createQueryBuilder("user")
    .where("user.username = :username", { username })
    .andWhere("LOWER(user.email) = :email", { email: email.trim().toLowerCase() })
    .getMany();
  return users[0] ?? null;
}

/**
 * Create a one-time raw token while persisting only its SHA-256 hash.
 * Returns null for an unknown username/email pair and during the one-minute
 * resend cooldown (callers validate the pair first when they need to
 * distinguish a mismatch from the cooldown state).
 */
export async function createPasswordResetToken(
  username: string,
  email: string,
  ttlMinutes: number,
): Promise<{ user: ApplicationUser; rawToken: string } | null> {
  const dataSource = await getDataSource();
  const user = await findUserByUsernameAndEmail(username, email);
  if (!user) return null;
  const now = new Date();
  const cooldownStart = new Date(now.getTime() - RESEND_COOLDOWN_MS);
  const recent = await dataSource.getRepository(PasswordResetTokenEntity)
    .createQueryBuilder("token")
    .where("token.user_id = :userId", { userId: Number(user.id) })
    .andWhere("token.created_at > :cooldownStart", { cooldownStart })
    .getOne();
  if (recent) return null;
  await dataSource.getRepository(PasswordResetTokenEntity)
    .createQueryBuilder()
    .update()
    .set({ usedAt: now })
    .where("user_id = :userId", { userId: Number(user.id) })
    .andWhere("used_at IS NULL")
    .execute();
  const rawToken = randomBytes(32).toString("base64url");
  await dataSource.getRepository(PasswordResetTokenEntity).save({
    userId: Number(user.id),
    tokenHash: hashResetToken(rawToken),
    expiresAt: new Date(now.getTime() + Math.max(1, ttlMinutes) * 60 * 1000),
  });
  return { user, rawToken };
}

/** Revoke one unused token (delivery failed or was never sent). */
export async function revokePasswordResetToken(rawToken: string): Promise<void> {
  const dataSource = await getDataSource();
  await dataSource.getRepository(PasswordResetTokenEntity)
    .createQueryBuilder()
    .update()
    .set({ usedAt: new Date() })
    .where("token_hash = :hash", { hash: hashResetToken(rawToken) })
    .andWhere("used_at IS NULL")
    .execute();
}

/**
 * Atomically consume a valid, unused, unexpired token and replace the
 * account password. Strips the legacy ``must_reset|`` / ``legacy:`` display
 * markers once a real password exists.
 */
export async function consumePasswordResetToken(
  username: string,
  rawToken: string,
  passwordHash: string,
): Promise<ApplicationUser | null> {
  const dataSource = await getDataSource();
  const user = await dataSource.getRepository(ApplicationUserEntity).findOneBy({ username });
  if (!user) return null;
  const now = new Date();
  const token = await dataSource.getRepository(PasswordResetTokenEntity)
    .createQueryBuilder("token")
    .where("token.user_id = :userId", { userId: Number(user.id) })
    .andWhere("token.token_hash = :hash", { hash: hashResetToken(rawToken) })
    .andWhere("token.used_at IS NULL")
    .andWhere("token.expires_at > :now", { now })
    .getOne();
  if (!token) return null;
  token.usedAt = now;
  await dataSource.getRepository(PasswordResetTokenEntity).save(token);
  user.passwordHash = passwordHash;
  const cleanName = stripInternalDisplayMarkers(user.displayName, user.username);
  user.displayName = cleanName;
  await dataSource.getRepository(ApplicationUserEntity).save(user);
  const profile = await dataSource.getRepository(MemberProfileEntity).findOneBy({ userId: Number(user.id) });
  if (profile) {
    profile.displayName = cleanName;
    await dataSource.getRepository(MemberProfileEntity).save(profile);
  }
  return user;
}
