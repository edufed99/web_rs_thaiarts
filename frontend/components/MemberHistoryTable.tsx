"use client";

import Link from "next/link";
import React from "react";

import { useTranslation } from "@/contexts/LanguageContext";
import type { HistoryEntryOut } from "@/lib/types";

interface MemberHistoryTableProps {
  entries: HistoryEntryOut[];
  /** Set to true when more rows exist than ``entries.length``. */
  hasMore?: boolean;
}

/**
 * Renders the "ประวัติการรับชมและให้คะแนน" table from the member_user mockup.
 *
 * One row per ``interaction_logs`` entry. We collapse unlike / unsave /
 * rate into a clean set of actions so the table mirrors the mockup's
 * columns (ชุดการแสดง, ปฏิสัมพันธ์ผู้ใช้, วันที่, คะแนน, ดู).
 */
export function MemberHistoryTable({ entries, hasMore }: MemberHistoryTableProps) {
  const { t, locale } = useTranslation();

  if (entries.length === 0) {
    return (
      <div className="member-history-empty">
        {t("historyTable.empty")}
      </div>
    );
  }

  return (
    <>
      <table className="member-history-table" aria-label={t("historyTable.tableAria")}>
        <thead>
          <tr>
            <th>{t("historyTable.colPerformance")}</th>
            <th>{t("historyTable.colInteraction")}</th>
            <th>{t("historyTable.colDate")}</th>
            <th>{t("historyTable.colRating")}</th>
            <th>{t("historyTable.colView")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const displayName = locale === "en" && entry.item_name_en ? entry.item_name_en : entry.item_name;
            return (
              <tr key={entry.log_id}>
                <td>
                  <Link href={`/items/${entry.item_id}`} className="item-name">
                    {displayName}
                  </Link>
                </td>
                <td>
                  {entry.context_name ? (
                    <span className="context-pill-mini">{entry.context_name}</span>
                  ) : (
                    <span className="context-pill-mini" style={{ opacity: 0.55 }}>
                      {labelForAction(entry.action_type, t)}
                    </span>
                  )}
                </td>
                <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {formatLocalizedDate(entry.created_at, locale)}
                </td>
                <td>
                  <span
                    className="stars"
                    aria-label={
                      entry.rating
                        ? t("historyTable.starsCount").replace("{rating}", String(entry.rating))
                        : t("historyTable.noRating")
                    }
                  >
                    {entry.rating
                      ? Array.from({ length: 5 }, (_, i) => (
                          <span key={i} className={i < entry.rating! ? "" : "off"}>
                            {i < entry.rating! ? "★" : "☆"}
                          </span>
                        ))
                      : <span className="off">—</span>}
                  </span>
                </td>
                <td>
                  <Link
                    href={`/items/${entry.item_id}`}
                    className="row-action"
                    aria-label={t("historyTable.viewPerformance").replace("{name}", displayName)}
                    title={t("historyTable.viewPerformance").replace("{name}", displayName)}
                  >
                    ◌
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore ? (
        <p style={{ textAlign: "right", color: "var(--muted)", fontSize: 12, margin: 0 }}>
          {t("historyTable.hasMore").replace("{count}", String(entries.length))}
        </p>
      ) : null}
    </>
  );
}

function labelForAction(action: string, t: (key: string) => string): string {
  if (action === "like") return t("historyTable.actionLike");
  if (action === "unlike") return t("historyTable.actionUnlike");
  if (action === "save") return t("historyTable.actionSave");
  if (action === "unsave") return t("historyTable.actionUnsave");
  if (action === "rate") return t("historyTable.actionRate");
  return action;
}

function formatLocalizedDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
