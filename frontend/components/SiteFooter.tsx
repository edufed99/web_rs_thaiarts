"use client";

import Link from "next/link";
import React from "react";

import { useTranslation } from "@/contexts/LanguageContext";

/**
 * Site-wide footer used by every public page. Four columns mirror the
 * mockup homepage: brand blurb, primary nav, help links, contact info.
 */
export function SiteFooter() {
  const { t } = useTranslation();

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer-inner">
        <div className="site-footer-col brand-col">
          <Link href="/" className="site-footer-brand">
            <span className="site-brand-mark" aria-hidden="true">น</span>
            <strong>{t("nav.brand")}</strong>
          </Link>
          <p className="site-footer-tagline">
            {t("footer.description")}
          </p>
          <div className="site-footer-social" aria-label="Social media">
            <a href="#" aria-label="Facebook">f</a>
            <a href="#" aria-label="YouTube">▶</a>
            <a href="#" aria-label="Instagram">◎</a>
            <a href="#" aria-label="Line">●</a>
          </div>
        </div>

        <div className="site-footer-col">
          <h3>{t("footer.quickLinks")}</h3>
          <ul>
            <li><Link href="/">{t("nav.home")}</Link></li>
            <li><Link href="/items">{t("nav.catalog")}</Link></li>
            <li><Link href="/categories">{t("nav.categories")}</Link></li>
            <li><Link href="/profile">{t("nav.profile")}</Link></li>
            <li><Link href="/login">{t("nav.login")}</Link></li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h3>{t("footer.help")}</h3>
          <ul>
            <li><Link href="/about">{t("footer.aboutDeveloper")}</Link></li>
            <li><Link href="/privacy">{t("footer.privacy")}</Link></li>
            <li><Link href="/terms">{t("footer.terms")}</Link></li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h3>{t("footer.contact")}</h3>
          <ul className="contact">
            <li>✉ <a href="mailto:dpatt148@gmail.com">dpatt148@gmail.com</a></li>
            <li>📍 Faculty of Arts Education, Bunditpatanasilpa Institute of Fine Arts, Ministry of Culture</li>
          </ul>
        </div>
      </div>

      <div className="site-footer-bottom">
        <small>© 2026 {t("nav.brand")} — {t("footer.copyright")}</small>
      </div>
    </footer>
  );
}
