import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Thai Arts Recommender",
  description: "Eligibility-gated hybrid recommender for Thai performing arts",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", "Sarabun", "Noto Sans Thai", sans-serif',
          backgroundColor: "#fafbfc",
          color: "#1a1a1a",
        }}
      >
        <header
          style={{
            padding: "1rem 1.5rem",
            backgroundColor: "#1e6fd9",
            color: "#fff",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>
            Thai Arts Recommender
          </h1>
          <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", opacity: 0.85 }}>
            ระบบแนะนำการแสดงงานศิลปะไทย (Eligibility-Gated Hybrid)
          </p>
        </header>
        <main style={{ maxWidth: "960px", margin: "0 auto", padding: "1.5rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}