"use client";

import React, { useEffect, useState } from "react";

import { ApiClientError, getContexts } from "@/lib/api";
import { groupContexts } from "@/lib/contextGroups";
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

  const contextGroups = groupContexts(contexts);

  return (
    <label className="field">
      <span>โอกาสที่ใช้แสดง</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
      >
        <option value="">— เลือกโอกาสที่ใช้แสดง —</option>
        {contextGroups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
