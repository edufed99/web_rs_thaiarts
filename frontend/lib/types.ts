// lib/types.ts — TypeScript mirrors of the backend Pydantic schemas.
//
// These types are hand-aligned with backend/app/schemas/. They are the contract
// that the typed fetch client (lib/api.ts) and the React components share.
//
// This module is a re-export barrel. The type definitions live in
// per-domain modules (catalog, member, auth, admin); importers of
// `@/lib/types` (and the relative `./types` imports used by the endpoint
// domain modules in lib/) keep working unchanged.

export * from "./types/catalog";
export * from "./types/member";
export * from "./types/auth";
export * from "./types/admin";
