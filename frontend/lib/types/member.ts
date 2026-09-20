// lib/types/member.ts — Member (``/me/*``) and member profile types.
//
// Domain subset of the backend Pydantic contract (see ``lib/types.ts`` barrel).
// Covers the member summary/history/saved/liked/rated/recent-views journeys,
// the member profile (``/me`` profile), and the member dashboard payload.

export interface InterestBucket {
  name: string;
  percent: number;
  is_top: boolean;
}

export interface UserSummaryOut {
  user_key: string;
  liked_count: number;
  saved_count: number;
  rated_count: number;
  recent_view_count: number;
  interests: InterestBucket[];
  has_activity: boolean;
  source: "postgres" | "disabled";
}

export interface RatingBucketOut {
  stars: number;
  count: number;
}

export interface RatingSummaryOut {
  average: number;
  total: number;
  distribution: RatingBucketOut[];
}

export interface HistoryEntryOut {
  log_id: number;
  item_id: number;
  item_name: string;
  item_name_en?: string | null;
  context_name: string;
  action_type: string;
  rating: number | null;
  created_at: string;
}

export interface HistoryListOut {
  items: HistoryEntryOut[];
  total: number;
}

export interface SavedItemsOut {
  items: number[];
  total: number;
}

export interface LikedItemsOut {
  items: number[];
  total: number;
}

export interface RatedItemOut {
  item_id: number;
  rating: number;
  updated_at: string;
}

export interface RatedItemsOut {
  items: RatedItemOut[];
  total: number;
}

export interface RecentViewOut {
  item_id: number;
  item_name: string;
  item_name_en?: string | null;
  viewed_at: string;
}

export interface RecentViewsOut {
  items: RecentViewOut[];
  total: number;
  window_days: number;
}

export type MemberRole = "user" | "super_admin";

export interface MemberProfileOut {
  user_id: number;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  role: MemberRole;
  consent_accepted?: boolean;
  consent_version?: string;
  consent_accepted_at?: string | null;
  consent_withdrawn_at?: string | null;
  created_at: string | null;
  last_login_at: string | null;
  updated_at: string | null;
}

export interface MemberProfileUpdate {
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  withdraw_consent?: boolean;
  accept_consent?: boolean;
}

export interface MemberDashboardOut {
  profile: MemberProfileOut;
  summary: UserSummaryOut;
  recent_activity: HistoryListOut;
  recent_views: RecentViewsOut;
}
