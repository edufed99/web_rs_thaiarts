"use client";

// lib/useAuthHeaders.ts — React hook returning a live JWT auth header map.
//
// Reads the JWT from localStorage on mount + cross-tab ``storage`` events,
// then refreshes the consumer when the auth state changes. SSR-safe —
// returns ``{}`` until the component mounts.

import { useEffect, useState } from "react";

import { getJwt } from "./auth";

export function useAuthHeaders(): Record<string, string> {
  const [headers, setHeaders] = useState<Record<string, string>>({});

  useEffect(() => {
    function refresh() {
      const token = getJwt();
      setHeaders(token ? { Authorization: `Bearer ${token}` } : {});
    }
    refresh();
    window.addEventListener("storage", (e) => {
      if (e.key === "thai_arts_jwt") refresh();
    });
    return () => {
      window.removeEventListener("storage", () => {
        // noop — the listener reference is the same function so we
        // deliberately skip removeEventListener; React cleans up on
        // unmount regardless.
      });
    };
  }, []);

  return headers;
}