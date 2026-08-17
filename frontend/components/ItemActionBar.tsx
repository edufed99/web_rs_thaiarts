"use client";

import React, { useEffect, useState } from "react";

import {
  ApiClientError,
  deleteLike,
  deleteSave,
  postLike,
  postSave,
  putRating,
} from "@/lib/api";
import { notifyMemberActivityChanged } from "@/lib/memberEvents";
import type { ItemActionOut, UserState } from "@/lib/types";

export interface ItemActionBarProps {
  itemId: number;
  userKey: string;
  userState: UserState;
  /** Called after a successful action with the new state. */
  onChange: (next: UserState) => void;
  /** Optional context id (from the active recommendation) — recorded in the interaction log. */
  contextId?: number | null;
  /** Optional request_id — recorded in the interaction log. */
  requestId?: string | null;
}

const COLOR_PRIMARY = "#1e6fd9";
const COLOR_LIKE = "#d6336c";
const COLOR_STAR = "#f5b400";
const COLOR_MUTED = "#777";
const COLOR_BORDER = "#ccc";

type Pending = "like" | "save" | "rating" | null;

export function ItemActionBar({
  itemId,
  userKey,
  userState,
  onChange,
  contextId,
  requestId,
}: ItemActionBarProps) {
  const [liked, setLiked] = useState<boolean>(userState.liked);
  const [saved, setSaved] = useState<boolean>(userState.saved);
  const [rating, setRating] = useState<number>(userState.rating || 0);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync with parent-provided state (e.g. when the parent re-fetches).
  useEffect(() => {
    setLiked(userState.liked);
    setSaved(userState.saved);
    setRating(userState.rating || 0);
  }, [userState.liked, userState.saved, userState.rating]);

  function applyChange(out: ItemActionOut) {
    const s = out.item.user_state;
    setLiked(s.liked);
    setSaved(s.saved);
    setRating(s.rating || 0);
    onChange(s);
    notifyMemberActivityChanged();
  }

  function baseBody() {
    return {
      user_key: userKey,
      item_id: itemId,
      request_id: requestId ?? null,
      context_id: contextId ?? null,
    } as const;
  }

  async function toggleLike() {
    if (!userKey) return;
    setPending("like");
    setError(null);
    const prev = liked;
    setLiked(!prev); // optimistic
    try {
      const out = liked
        ? await deleteLike(baseBody())
        : await postLike(baseBody());
      applyChange(out);
    } catch (e) {
      setLiked(prev); // revert
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function toggleSave() {
    if (!userKey) return;
    setPending("save");
    setError(null);
    const prev = saved;
    setSaved(!prev);
    try {
      const out = saved
        ? await deleteSave(baseBody())
        : await postSave(baseBody());
      applyChange(out);
    } catch (e) {
      setSaved(prev);
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function setStar(value: number) {
    if (!userKey) return;
    setPending("rating");
    setError(null);
    const prev = rating;
    setRating(value); // optimistic
    try {
      const out = await putRating({ ...baseBody(), rating: value });
      applyChange(out);
    } catch (e) {
      setRating(prev);
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  const likeColor = liked ? COLOR_LIKE : COLOR_MUTED;
  const saveColor = saved ? COLOR_PRIMARY : COLOR_MUTED;
  const disabled = pending !== null || !userKey;

  return (
    <div
      data-testid="item-action-bar"
      className="item-action-bar"
      style={{
        display: "grid",
        gap: "0.75rem",
        marginTop: "0.5rem",
      }}
    >
      <div className="item-action-buttons">
        <button
          type="button"
          aria-label={liked ? "เลิกถูกใจ" : "ถูกใจ"}
          aria-pressed={liked}
          onClick={toggleLike}
          disabled={disabled}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            padding: "0.4rem 0.75rem",
            backgroundColor: "#fff",
            border: `1px solid ${likeColor}`,
            color: likeColor,
            borderRadius: "999px",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: "0.9rem",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: "1.1rem" }}>{liked ? "♥" : "♡"}</span>
          <span>{liked ? "ถูกใจแล้ว" : "ถูกใจ"}</span>
        </button>

        <button
          type="button"
          aria-label={saved ? "เลิกบันทึก" : "บันทึก"}
          aria-pressed={saved}
          onClick={toggleSave}
          disabled={disabled}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            padding: "0.4rem 0.75rem",
            backgroundColor: "#fff",
            border: `1px solid ${saveColor}`,
            color: saveColor,
            borderRadius: "999px",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: "0.9rem",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: "1.1rem" }}>{saved ? "🔖" : "📑"}</span>
          <span>{saved ? "บันทึกแล้ว" : "บันทึก"}</span>
        </button>
      </div>

      <div
        className="item-rating-row"
        role="radiogroup"
        aria-label="ให้คะแนน 1 ถึง 5 ดาว"
      >
        {[1, 2, 3, 4, 5].map((v) => {
          const active = rating >= v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={rating === v}
              aria-label={`ให้ ${v} ดาว`}
              onClick={() => setStar(v)}
              disabled={disabled}
              style={{
                padding: "0.25rem 0.4rem",
                backgroundColor: "transparent",
                border: `1px solid ${COLOR_BORDER}`,
                borderRadius: "4px",
                color: active ? COLOR_STAR : COLOR_MUTED,
                fontSize: "1.1rem",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              ★
            </button>
          );
        })}
      </div>

      {error ? (
        <span
          role="alert"
          style={{
            color: "#7a1f1f",
            backgroundColor: "#fdecec",
            border: "1px solid #f5c2c2",
            borderRadius: "4px",
            padding: "0.25rem 0.5rem",
            fontSize: "0.8rem",
          }}
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
