// lib/member.ts — /me/* member summary/history/saved/liked/rated/recent +
// member profile + avatar + member dashboard functions.

import type {
  HistoryListOut,
  LikedItemsOut,
  MemberDashboardOut,
  MemberProfileOut,
  MemberProfileUpdate,
  RatedItemsOut,
  RecentViewsOut,
  RatingSummaryOut,
  SavedItemsOut,
  UserSummaryOut,
} from "./types";
import { getAuthHeaders } from "./auth";
import { baseUrl, handle, memberParams, mutateJson, mutationHeaders } from "./http";

export async function getMeSummary(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<UserSummaryOut> {
  const url = `${baseUrl()}/me/summary?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<UserSummaryOut>(res);
}

export async function getMeHistory(
  userKey: string,
  limit = 20,
  extraHeaders: Record<string, string> = {},
): Promise<HistoryListOut> {
  const url = `${baseUrl()}/me/history?${memberParams(userKey, { limit })}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<HistoryListOut>(res);
}

export async function getMeSaved(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<SavedItemsOut> {
  const url = `${baseUrl()}/me/saved?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<SavedItemsOut>(res);
}

export async function getMeLiked(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<LikedItemsOut> {
  const url = `${baseUrl()}/me/liked?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<LikedItemsOut>(res);
}

export async function getMeRated(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<RatedItemsOut> {
  const url = `${baseUrl()}/me/rated?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<RatedItemsOut>(res);
}

export async function getMeRatingSummary(
  userKey: string,
  extraHeaders: Record<string, string> = {},
): Promise<RatingSummaryOut> {
  const url = `${baseUrl()}/me/rating-summary?${memberParams(userKey)}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<RatingSummaryOut>(res);
}

export async function getMeRecentViews(
  userKey: string,
  days = 30,
  limit = 20,
  extraHeaders: Record<string, string> = {},
): Promise<RecentViewsOut> {
  const url = `${baseUrl()}/me/recent-views?${memberParams(userKey, { days, limit })}`;
  const res = await fetch(url, { headers: { ...extraHeaders }, cache: "no-store" });
  return handle<RecentViewsOut>(res);
}

export async function getMemberProfile(): Promise<MemberProfileOut> {
  const res = await fetch(`${baseUrl()}/me/profile`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<MemberProfileOut>(res);
}

export async function patchMemberProfile(
  body: MemberProfileUpdate,
): Promise<MemberProfileOut> {
  return mutateJson("/me/profile", "PATCH", body, getAuthHeaders());
}

export async function uploadMemberAvatar(file: File): Promise<MemberProfileOut> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`${baseUrl()}/me/profile/avatar`, {
    method: "POST",
    headers: mutationHeaders({ ...getAuthHeaders() }),
    credentials: "same-origin",
    body: form,
    cache: "no-store",
  });
  return handle<MemberProfileOut>(res);
}

export async function deleteMemberAvatar(): Promise<MemberProfileOut> {
  const res = await fetch(`${baseUrl()}/me/profile/avatar`, {
    method: "DELETE",
    headers: mutationHeaders({ ...getAuthHeaders() }),
    credentials: "same-origin",
    cache: "no-store",
  });
  return handle<MemberProfileOut>(res);
}

export async function getMemberDashboard(): Promise<MemberDashboardOut> {
  const res = await fetch(`${baseUrl()}/me/dashboard`, {
    headers: { ...getAuthHeaders() },
    cache: "no-store",
  });
  return handle<MemberDashboardOut>(res);
}
