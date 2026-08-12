"use client";

import Link from "next/link";
import React from "react";

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
  if (entries.length === 0) {
    return (
      <div className="member-history-empty">
        ยังไม่มีประวัติการรับชม — เมื่อกดถูกใจ บันทึก หรือให้คะแนนรายการ ระบบจะบันทึกไว้ในตารางนี้
      </div>
    );
  }

  return (
    <>
      <table className="member-history-table" aria-label="ประวัติการรับชมและให้คะแนน">
        <thead>
          <tr>
            <th>ชุดการแสดง</th>
            <th>ปฏิสัมพันธ์ผู้ใช้</th>
            <th>วันที่</th>
            <th>คะแนน</th>
            <th>ดู</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.log_id}>
              <td>
                <Link href={`/items/${entry.item_id}`} className="item-name">
                  {entry.item_name}
                </Link>
              </td>
              <td>
                {entry.context_name ? (
                  <span className="context-pill-mini">{entry.context_name}</span>
                ) : (
                  <span className="context-pill-mini" style={{ opacity: 0.55 }}>
                    {labelForAction(entry.action_type)}
                  </span>
                )}
              </td>
              <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                {formatThaiDate(entry.created_at)}
              </td>
              <td>
                <span className="stars" aria-label={entry.rating ? `${entry.rating} ดาว` : "ไม่มีคะแนน"}>
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
                  aria-label={`ดู ${entry.item_name}`}
                  title={`ดู ${entry.item_name}`}
                >
                  ◌
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore ? (
        <p style={{ textAlign: "right", color: "var(--muted)", fontSize: 12, margin: 0 }}>
          แสดง {entries.length} รายการล่าสุด — ประวัติก่อนหน้าถูกตัดให้สั้นลงเพื่อความเร็ว
        </p>
      ) : null}
    </>
  );
}

function labelForAction(action: string): string {
  if (action === "like") return "ถูกใจ";
  if (action === "unlike") return "ยกเลิกถูกใจ";
  if (action === "save") return "บันทึก";
  if (action === "unsave") return "ยกเลิกบันทึก";
  if (action === "rate") return "ให้คะแนน";
  return action;
}

function formatThaiDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
