"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  type Locale,
  type TranslationDictionary,
  getDictionary,
  translate,
} from "@/locales";

export const LOCALE_COOKIE_KEY = "NEXT_LOCALE";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (keyPath: string) => string;
  dict: TranslationDictionary;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({
  children,
  initialLocale = "th",
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    // Check localStorage on mount if different
    const saved = localStorage.getItem(LOCALE_COOKIE_KEY) as Locale | null;
    if (saved && (saved === "th" || saved === "en") && saved !== locale) {
      setLocaleState(saved);
      document.cookie = `${LOCALE_COOKIE_KEY}=${saved}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
    }
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(LOCALE_COOKIE_KEY, newLocale);
    document.cookie = `${LOCALE_COOKIE_KEY}=${newLocale}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  }, []);

  const dict = getDictionary(locale);

  const t = useCallback(
    (keyPath: string) => {
      return translate(dict, keyPath);
    },
    [dict],
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, dict }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return ctx;
}
