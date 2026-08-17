// lib/api.ts — Typed REST client for the FastAPI backend.
//
// Uses the same-origin Next.js Application Backend. Internal service
// addresses stay server-only and are never embedded in browser bundles.
//
// This module is a re-export barrel. The endpoint functions live in
// per-domain modules (catalog, metrics, recommendations, actions, member,
// admin, auth); the URL helpers live in `./urls` and the shared error type in
// `./errors`. Importers of `@/lib/api` keep working unchanged.

export { ApiClientError } from "./errors";
export { getBaseUrl, resolveImageUrl } from "./urls";

export {
  getContexts,
  getKeywords,
  getItems,
  getItem,
  getItemsBatch,
  getSimilarItems,
  getItemLegacyStats,
  getItemEngagementBatch,
  getItemLegacyStatsBatch,
} from "./catalog";

export {
  getHealth,
  getMetrics,
  getRequestTrend,
  getModelConfig,
  getDashboard,
  getAnalytics,
  downloadDashboardReport,
} from "./metrics";

export { postRecommendations, getProfileRecommendations } from "./recommendations";

export { postLike, deleteLike, postSave, deleteSave, putRating, postView } from "./actions";

export {
  getMeSummary,
  getMeHistory,
  getMeSaved,
  getMeLiked,
  getMeRated,
  getMeRatingSummary,
  getMeRecentViews,
  getMemberProfile,
  patchMemberProfile,
  uploadMemberAvatar,
  deleteMemberAvatar,
  getMemberDashboard,
} from "./member";

export {
  postSignup,
  postLogin,
  googleLoginStartUrl,
  postGoogleLoginExchange,
  getMe,
  patchMe,
  postPasswordResetRequest,
  postPasswordResetConfirm,
} from "./auth";

export {
  getGmailOAuthStatus,
  startGmailOAuth,
  getAdminUsers,
  postAdminUser,
  putAdminUser,
  deleteAdminUser,
  postItemDraft,
  postItemCommit,
  putAdminItem,
  getItemFacets,
  deleteAdminItem,
  uploadItemImage,
  uploadItemVideo,
  getPublicationStatus,
  executePublication,
} from "./admin";
