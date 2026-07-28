"use client";

import React from "react";

export interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "กำลังโหลด..." }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: "1.5rem",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        backgroundColor: "#fafafa",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "16px",
          height: "16px",
          border: "2px solid #888",
          borderTopColor: "transparent",
          borderRadius: "50%",
          display: "inline-block",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <span>{message}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}