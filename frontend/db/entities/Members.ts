import { EntitySchema } from "typeorm";

export interface ApplicationUser {
  id: number;
  username: string;
  email: string;
  passwordHash: string;
  googleSubjectId: string | null;
  authProvider: string;
  emailVerified: boolean;
  displayName: string;
  isAdmin: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface MemberProfile {
  id: number;
  userId: number;
  displayName: string;
  role: "user" | "super_admin";
  userGroup: "user" | "super_admin";
  experienceLevel: string;
  avatarUrl: string;
  bio: string;
  consentAccepted: boolean;
  consentVersion: string;
  consentAcceptedAt: Date | null;
  consentWithdrawnAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UserSession {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
}

interface PasswordResetToken {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

interface MemberActionState {
  id: number;
  userKey: string;
  itemId: number;
  createdAt: Date;
}

interface MemberRating extends MemberActionState {
  rating: number;
  updatedAt: Date;
}

interface MemberInteraction {
  id: number;
  userKey: string;
  itemId: number | null;
  actionType: string;
  metadataJson: string;
  recommendationRequestId: number | null;
  createdAt: Date;
}

export const ApplicationUserEntity = new EntitySchema<ApplicationUser>({
  name: "ApplicationUser",
  tableName: "users",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    username: { type: String, length: 120, unique: true },
    email: { type: String, length: 320, default: "" },
    passwordHash: { name: "password_hash", type: String, length: 255 },
    googleSubjectId: { name: "google_subject_id", type: String, length: 255, nullable: true },
    authProvider: { name: "auth_provider", type: String, length: 32, default: "password" },
    emailVerified: { name: "email_verified", type: Boolean, default: false },
    displayName: { name: "display_name", type: String, length: 120, default: "" },
    isAdmin: { name: "is_admin", type: Boolean, default: false },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    lastLoginAt: { name: "last_login_at", type: "timestamptz", nullable: true },
  },
});

export const MemberProfileEntity = new EntitySchema<MemberProfile>({
  name: "MemberProfile",
  tableName: "accounts_userprofile",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    userId: { name: "user_id", type: "bigint", unique: true },
    displayName: { name: "display_name", type: String, length: 150, default: "" },
    role: { type: String, length: 20, default: "user" },
    userGroup: { name: "user_group", type: String, length: 100, default: "user" },
    experienceLevel: { name: "experience_level", type: String, length: 20, default: "none" },
    avatarUrl: { name: "avatar_url", type: "text", default: "" },
    bio: { type: "text", default: "" },
    consentAccepted: { name: "consent_accepted", type: Boolean, default: false },
    consentVersion: { name: "consent_version", type: String, length: 40, default: "" },
    consentAcceptedAt: { name: "consent_accepted_at", type: "timestamptz", nullable: true },
    consentWithdrawnAt: { name: "consent_withdrawn_at", type: "timestamptz", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
  },
});

export const UserSessionEntity = new EntitySchema<UserSession>({
  name: "UserSession",
  tableName: "user_sessions",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    userId: { name: "user_id", type: "bigint" },
    tokenHash: { name: "token_hash", type: String, length: 64, unique: true },
    expiresAt: { name: "expires_at", type: "timestamptz" },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    lastSeenAt: { name: "last_seen_at", type: "timestamptz", updateDate: true },
  },
});

export const PasswordResetTokenEntity = new EntitySchema<PasswordResetToken>({
  name: "PasswordResetToken",
  tableName: "password_reset_tokens",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    userId: { name: "user_id", type: "bigint" },
    tokenHash: { name: "token_hash", type: String, length: 64, unique: true },
    expiresAt: { name: "expires_at", type: "timestamptz" },
    usedAt: { name: "used_at", type: "timestamptz", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
});

function stateEntity(name: string, tableName: string): EntitySchema<MemberActionState> {
  return new EntitySchema<MemberActionState>({
    name,
    tableName,
    columns: {
      id: { type: "bigint", primary: true, generated: "increment" },
      userKey: { name: "user_key", type: String, length: 150 },
      itemId: { name: "item_id", type: "bigint" },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
  });
}

export const LikeEntity = stateEntity("MemberLike", "likes");
export const SavedItemEntity = stateEntity("MemberSavedItem", "saved_items");

export const RatingEntity = new EntitySchema<MemberRating>({
  name: "MemberRating",
  tableName: "ratings",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    userKey: { name: "user_key", type: String, length: 150 },
    itemId: { name: "item_id", type: "bigint" },
    rating: { type: "smallint" },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
  },
});

export const InteractionLogEntity = new EntitySchema<MemberInteraction>({
  name: "MemberInteraction",
  tableName: "interaction_logs",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    userKey: { name: "user_key", type: String, length: 150 },
    itemId: { name: "item_id", type: "bigint", nullable: true },
    actionType: { name: "action_type", type: String, length: 40 },
    metadataJson: { name: "metadata_json", type: "text", default: "" },
    recommendationRequestId: { name: "recommendation_request_id", type: "bigint", nullable: true },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
});

export const memberEntities = [
  ApplicationUserEntity,
  MemberProfileEntity,
  UserSessionEntity,
  PasswordResetTokenEntity,
  LikeEntity,
  SavedItemEntity,
  RatingEntity,
  InteractionLogEntity,
];
