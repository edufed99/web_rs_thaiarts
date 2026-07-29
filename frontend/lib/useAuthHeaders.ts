"use client";

// lib/useAuthHeaders.ts — React hook returning a live JWT auth header map.
//
// Reads the JWT from localStorage on mount + cross-tab ``storage`` events,
// then refreshes the consumer when the auth state changes. SSR-safe —
// returns ``{}`` until the component mounts.

import { useEffect, useState } from "react";

import { AUTH_CHANGED_EVENT, STORAGE_KEY, getJwt } from "./auth";

export function useAuthHeaders(): Record<string, string> {
  const [headers, setHeaders] = useState<Record<string, string>>({});

  useEffect(() => {
    function refresh() {
      const token = getJwt();
      setHeaders(token ? { Authorization: `Bearer ${token}` } : {});
    }
    function handleStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) refresh();
    }
    refresh();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return headers;
}
