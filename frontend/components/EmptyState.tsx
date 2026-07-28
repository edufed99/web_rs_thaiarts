"use client";

import React from "react";

export interface EmptyStateProps {
  title?: string;
  message?: string;
}

export function EmptyState({
  title = "ไม่พบผลลัพธ์",
  message = "ลองเลือกบริบทหรือคำสำคัญอื่น",
}: EmptyStateProps) {
  return (
    <div
      style={{
        padding: "1.5rem",
        border: "1px dashed #ccc",
        borderRadius: "8px",
        backgroundColor: "#fff",
        color: "#555",
        textAlign: "center",
      }}
    >
      <strong style={{ display: "block", marginBottom: "0.5rem" }}>{title}</strong>
      <p style={{ margin: 0 }}>{message}</p>
    </div>
  );
}