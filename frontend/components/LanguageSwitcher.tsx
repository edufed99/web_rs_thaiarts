"use client";

import React from "react";
import { useTranslation } from "@/contexts/LanguageContext";

interface Props {
  className?: string;
  variant?: "header" | "admin" | "mobile";
}

export function LanguageSwitcher({ className = "", variant = "header" }: Props) {
  const { locale, setLocale } = useTranslation();

  return (
    <div
      role="group"
      aria-label="Language selection"
      className={`lang-switcher-pill ${variant} ${className}`.trim()}
    >
      <button
        type="button"
        aria-pressed={locale === "th"}
        className={`lang-btn ${locale === "th" ? "active" : ""}`}
        onClick={() => setLocale("th")}
      >
        TH
      </button>
      <span className="lang-divider">|</span>
      <button
        type="button"
        aria-pressed={locale === "en"}
        className={`lang-btn ${locale === "en" ? "active" : ""}`}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
    </div>
  );
}
