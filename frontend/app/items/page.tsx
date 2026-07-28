"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CatalogItemCard } from "@/components/CatalogItemCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

import { ApiClientError, getContexts, getItems } from "@/lib/api";
import type { ContextOut, ItemListOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

const PAGE_SIZE = 20;

function ItemsContent() {
  const router = useRouter();
  const params = useSearchParams();

  const searchInput = params.get("q") ?? "";
  const contextIdStr = params.get("context");
  const contextId = contextIdStr ? Number(contextIdStr) : null;

  const [data, setData] = useState<ItemListOut | null>(null);
  const [contexts, setContexts] = useState<ContextOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [userKey, setUserKey] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);
  const [searchDraft, setSearchDraft] = useState<string>(searchInput);
  const authHeaders = useAuthHeaders();

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    setSearchDraft(searchInput);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    getContexts()
      .then((resp) => {
        if (!cancelled) setContexts(resp.contexts);
      })
      .catch(() => {
        // Non-fatal: the context dropdown can simply stay empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    getItems({
      search: searchInput || undefined,
      contextId: contextId ?? undefined,
      userKey: userKey || undefined,
      extraHeaders: authHeaders,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setError(e.message);
          setErrorCode(e.code);
        } else {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [searchInput, contextId, userKey, reloadKey, authHeaders]);

  const handleUserStateChange = useCallback((itemId: number, next: UserState) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId ? { ...it, user_state: next } : it,
        ),
      };
    });
  }, []);

  const updateUrl = useCallback(
    (next: { q?: string; context?: number | null }) => {
      const sp = new URLSearchParams();
      if (next.q) sp.set("q", next.q);
      if (next.context != null && next.context > 0) sp.set("context", String(next.context));
      const qs = sp.toString();
      router.push(`/items${qs ? `?${qs}` : ""}`);
    },
    [router],
  );

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateUrl({ q: searchDraft.trim(), context: contextId });
  };

  const onContextChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    updateUrl({ q: searchInput, context: v ? Number(v) : null });
  };

  const selectedContext = useMemo(
    () => (contextId != null ? contexts.find((c) => c.id === contextId) ?? null : null),
    [contextId, contexts],
  );

  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!data) {
    return <LoadingState message="กำลังโหลดแคตตาล็อก..." />;
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <form
        onSubmit={onSearchSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: "0.5rem",
          alignItems: "center",
          padding: "0.75rem 1rem",
          border: "1px solid #e0e0e0",
          borderRadius: "8px",
          backgroundColor: "#fff",
        }}
      >
        <input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="ค้นหาชื่อหรือคำสำคัญ..."
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid #ccc",
            borderRadius: "6px",
            fontSize: "1rem",
          }}
        />
        <select
          value={contextId ?? ""}
          onChange={onContextChange}
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid #ccc",
            borderRadius: "6px",
            fontSize: "1rem",
          }}
        >
          <option value="">— ทุกบริบท —</option>
          {contexts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#1e6fd9",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "1rem",
          }}
        >
          ค้นหา
        </button>
      </form>

      {selectedContext ? (
        <p style={{ margin: 0, color: "#555" }}>
          <strong>จัดอันดับตามบริบท:</strong> {selectedContext.name} · top {data.items.length} รายการ
        </p>
      ) : (
        <p style={{ margin: 0, color: "#555" }}>
          <strong>แคตตาล็อกทั้งหมด</strong> · {data.total} รายการ
        </p>
      )}

      {data.items.length === 0 ? (
        <EmptyState
          title="ไม่พบรายการ"
          message={selectedContext
            ? "บริบทนี้ยังไม่มีรายการที่เปิดใช้งาน"
            : "ลองเปลี่ยนคำค้นหรือเลือกบริบทอื่น"}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "1rem",
          }}
        >
          {data.items.map((item, idx) => (
            <CatalogItemCard
              key={item.id}
              item={item}
              userKey={userKey}
              contextId={contextId}
              rank={selectedContext ? idx + 1 : undefined}
              descriptionLimit={selectedContext ? 150 : 180}
              onUserStateChange={handleUserStateChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ItemsPage() {
  return (
    <Suspense fallback={<LoadingState message="กำลังเตรียมแคตตาล็อก..." />}>
      <ItemsContent />
    </Suspense>
  );
}