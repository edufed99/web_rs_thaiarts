"use client";

import React from "react";

import type { RecommendationResultOut } from "@/lib/types";

export interface RecommendationCardProps {
  result: RecommendationResultOut;
}

export function RecommendationCard({ result }: RecommendationCardProps) {
  const { rank, item, scores, matched_keywords, explanation } = result;

  return (
    <article
      style={{
        padding: "1.25rem",
        border: "1px solid #e0e0e0",
        borderRadius: "10px",
        backgroundColor: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
          #{rank} {item.name}
        </h3>
        <span
          style={{
            fontSize: "0.8rem",
            color: "#555",
            padding: "0.2rem 0.5rem",
            backgroundColor: "#f0f4ff",
            borderRadius: "999px",
          }}
        >
          hybrid {scores.hybrid.toFixed(3)}
        </span>
      </header>

      {item.category_group || item.performance_type ? (
        <p style={{ margin: "0.25rem 0", color: "#666", fontSize: "0.9rem" }}>
          {[item.category_group, item.performance_type].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {item.description ? (
        <p style={{ margin: "0.5rem 0", color: "#333" }}>{item.description}</p>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: "1rem",
          fontSize: "0.85rem",
          color: "#555",
          margin: "0.5rem 0",
        }}
      >
        <span>CBF: <strong>{scores.cbf.toFixed(3)}</strong></span>
        <span>CF: <strong>{scores.cf.toFixed(3)}</strong></span>
      </div>

      {matched_keywords.length > 0 ? (
        <p style={{ margin: "0.5rem 0", fontSize: "0.85rem" }}>
          คำสำคัญที่ตรง:{" "}
          {matched_keywords.map((kw, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                padding: "0.15rem 0.5rem",
                marginRight: "0.25rem",
                backgroundColor: "#fff8e1",
                border: "1px solid #ffe082",
                borderRadius: "4px",
              }}
            >
              {kw}
            </span>
          ))}
        </p>
      ) : null}

      {explanation ? (
        <p
          style={{
            margin: "0.75rem 0 0 0",
            padding: "0.75rem",
            backgroundColor: "#f7f7f9",
            borderLeft: "3px solid #1e6fd9",
            borderRadius: "4px",
            fontSize: "0.9rem",
            color: "#222",
          }}
        >
          {explanation}
        </p>
      ) : null}
    </article>
  );
}