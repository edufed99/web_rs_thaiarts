// lib/types/auth.ts — User/account, signup, login, and password-reset types.
//
// Domain subset of the backend Pydantic contract (see ``lib/types.ts`` barrel).
// Covers the password account lifecycle (``/api/auth/signup`` / ``login`` /
// password reset) and the member ``/me`` surface. ``UserOut`` is the shared
// account shape also consumed by the admin and member domains.

import type { MemberRole } from "./member";

export interface UserOut {
  id: number;
  username: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  role: MemberRole;
  auth_provider: string;
  email_verified: boolean;
  created_at: string | null;
  last_login_at: string | null;
}

export interface UserSignup {
  username: string;
  email?: string | null;
  password: string;
  display_name?: string | null;
}

export interface UserProfileUpdate {
  username?: string | null;
  email?: string | null;
  display_name?: string | null;
  current_password?: string | null;
  new_password?: string | null;
}

export interface PasswordResetRequest {
  username: string;
  email: string;
}

export interface PasswordResetRequestOut {
  accepted: boolean;
  credentials_valid: boolean;
  email_sent: boolean;
  delivery_configured: boolean;
  message: string;
}

export interface PasswordResetConfirm {
  username: string;
  token: string;
  new_password: string;
}

export interface PasswordResetConfirmOut {
  reset: boolean;
  message: string;
}

export interface UserLogin {
  username: string;
  password: string;
}

export interface TokenOut {
  /** JWT fields are absent for password sessions; issue #6 migrates Google SSO. */
  access_token?: string;
  token_type?: "bearer" | string;
  expires_in_seconds: number;
  user: UserOut;
}
