"use client";

/** Session cookies are attached by the browser; no bearer header is exposed. */
const SESSION_HEADERS: Record<string, string> = Object.freeze({});

export function useAuthHeaders(): Record<string, string> { return SESSION_HEADERS; }
