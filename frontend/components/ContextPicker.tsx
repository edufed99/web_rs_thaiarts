"use client";

import React, { useEffect, useState } from "react";

import { ApiClientError, getContexts } from "@/lib/api";
import { GROUP_LABELS_EN, groupContexts } from "@/lib/contextGroups";
import type { ContextOut } from "@/lib/types";
import { useTranslation } from "@/contexts/LanguageContext";

import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

export interface ContextPickerProps {
  value: number | null;
  onChange: (contextId: number | null) => void;
}

export function ContextPicker({ value, onChange }: ContextPickerProps) {
  const { locale, t } = useTranslation();
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
    return <LoadingState message={t("recommend.occasionLoading")} />;
  }
  if (contexts.length === 0) {
    return (
      <ErrorState
        title={t("recommend.occasionEmptyTitle")}
        message={t("recommend.occasionEmptyMessage")}
      />
    );
  }

  const contextGroups = groupContexts(contexts);

  return (
    <label className="field">
      <span>{t("recommend.occasionLabel")}</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
      >
        <option value="">{t("recommend.occasionPlaceholder")}</option>
        {contextGroups.map((group) => {
          const groupLabel =
            locale === "en" ? (GROUP_LABELS_EN[group.label] ?? group.label) : group.label;
          return (
            <optgroup key={group.label} label={groupLabel}>
              {group.contexts.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === "en" && c.name_en ? c.name_en : c.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}
