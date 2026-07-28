"use client";

import React, { useEffect, useState } from "react";

import { ApiClientError, getContexts } from "@/lib/api";
import type { ContextOut } from "@/lib/types";

import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

export interface ContextPickerProps {
  value: number | null;
  onChange: (contextId: number | null) => void;
}

export function ContextPicker({ value, onChange }: ContextPickerProps) {
  const [contexts, setContexts] = useState<ContextOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getContexts()
      .then((data) => {
        if (!cancelled) setContexts(data.contexts);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setError(e.message);
          setErrorCode(e.code);
        } else {
          setError(e instanceof Error ? e.message : "Unknown error");
          setErrorCode(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!contexts) {
    return <LoadingState message="กำลังโหลดบริบท..." />;
  }
  if (contexts.length === 0) {
    return <ErrorState title="ไม่มีบริบท" message="ยังไม่มีบริบทในระบบ" />;
  }

  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
        เลือกบริบท
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
        style={{
          padding: "0.5rem",
          fontSize: "1rem",
          border: "1px solid #ccc",
          borderRadius: "4px",
          minWidth: "260px",
        }}
      >
        <option value="">— เลือกบริบท —</option>
        {contexts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.active_item_count} รายการ)
          </option>
        ))}
      </select>
    </label>
  );
}