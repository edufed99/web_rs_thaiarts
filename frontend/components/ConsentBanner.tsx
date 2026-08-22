"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

const CONSENT_STORAGE_KEY = "recsys_research_consent_v1";

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
      if (!stored) {
        setVisible(true);
      }
    } catch {
      // Storage unavailable or disabled
    }
  }, []);

  function handleAccept() {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, "accepted");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside
      role="region"
      aria-label="การขอความยินยอมเพื่อการวิจัยและการใช้งานคุกกี้"
      style={{
        position: "fixed",
        bottom: "1rem",
        left: "50%",
        transform: "translateX(-50%)",
        width: "calc(100% - 2rem)",
        maxWidth: "860px",
        backgroundColor: "#1b2538",
        color: "#f0ede6",
        borderRadius: "12px",
        boxShadow: "0 12px 32px rgba(10, 15, 29, 0.4)",
        padding: "1rem 1.25rem",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        flexWrap: "wrap",
        fontSize: "0.875rem",
        lineHeight: 1.5,
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      <div style={{ flex: 1, minWidth: "260px" }}>
        <strong style={{ display: "block", marginBottom: "0.2rem", color: "#e8c37d" }}>
          🛡️ การขอความยินยอมและการคุ้มครองข้อมูลส่วนบุคคล (PDPA)
        </strong>
        <span>
          ระบบนี้มีการเก็บรวบรวมข้อมูลการให้คะแนนและปฏิสัมพันธ์การใช้งานเพื่อการศึกษาวิจัยและพัฒนาระบบแนะนำการแสดงนาฏศิลป์ไทย
          ตาม{" "}
          <Link
            href="/privacy"
            style={{ color: "#f3d38c", textDecoration: "underline", fontWeight: 700 }}
          >
            นโยบายความเป็นส่วนตัว
          </Link>
        </span>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          onClick={handleAccept}
          style={{
            backgroundColor: "#8a5b17",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            padding: "0.55rem 1.1rem",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.875rem",
            whiteSpace: "nowrap",
          }}
        >
          ยินยอมและดำเนินการต่อ
        </button>
      </div>
    </aside>
  );
}
