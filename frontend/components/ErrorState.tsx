"use client";

import React from "react";

export interface ErrorStateProps {
  title?: string;
  message: string;
  code?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "เกิดข้อผิดพลาด",
  message,
  code,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      style={{
        padding: "1.5rem",
        border: "1px solid #f5c2c2",
        borderRadius: "8px",
        backgroundColor: "#fdecec",
        color: "#7a1f1f",
      }}
    >
      <strong style={{ display: "block", marginBottom: "0.5rem" }}>{title}</strong>
      <p style={{ margin: 0 }}>{message}</p>
      {code ? (
        <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85em", opacity: 0.8 }}>
          code: <code>{code}</code>
        </p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            backgroundColor: "#7a1f1f",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          ลองอีกครั้ง
        </button>
      ) : null}
    </div>
  );
}