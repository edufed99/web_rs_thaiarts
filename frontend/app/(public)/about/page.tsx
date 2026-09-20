"use client";

import Image from "next/image";
import Link from "next/link";
import React from "react";

import { useTranslation } from "@/contexts/LanguageContext";

export default function AboutPage() {
  const { t, locale } = useTranslation();

  return (
    <div className="about-page section-stack">
      <section className="about-hero" aria-labelledby="developer-name">
        <div className="about-portrait-frame">
          <Image
            src="/img/system-developer-pichaya.jpg"
            alt={locale === "en" ? "Pichaya Dumnil - System Developer" : "Pichaya Dumnil ผู้พัฒนาระบบ"}
            width={1284}
            height={1605}
            priority
            className="about-portrait"
            sizes="(max-width: 760px) 76vw, 380px"
          />
        </div>

        <div className="about-hero-copy">
          <p className="eyebrow">System Developer</p>
          <h1 id="developer-name">Pichaya Dumnil</h1>
          <p className="about-role">{t("about.developerRole")}</p>
          <p className="about-intro">{t("about.developerIntro")}</p>
          <div className="about-actions">
            <a className="site-button primary" href="mailto:dpatt148@gmail.com">
              {t("about.emailButton")}
            </a>
            <Link className="site-button ghost" href="/">
              {t("about.homeButton")}
            </Link>
          </div>
        </div>
      </section>

      <section className="about-detail-grid" aria-label={t("about.developerInfo")}>
        <article className="about-info-card">
          <span className="about-card-icon" aria-hidden="true">◎</span>
          <div>
            <h2>{t("about.workplace")}</h2>
            <p>Faculty of Arts Education</p>
            <p>Bunditpatanasilpa Institute of Fine Arts</p>
            <p>Ministry of Culture</p>
          </div>
        </article>

        <article className="about-info-card">
          <span className="about-card-icon" aria-hidden="true">✉</span>
          <div>
            <h2>{t("about.contact")}</h2>
            <p>{t("about.contactDesc")}</p>
            <a href="mailto:dpatt148@gmail.com">dpatt148@gmail.com</a>
          </div>
        </article>
      </section>

      <section className="about-project-card">
        <div>
          <p className="eyebrow">About the Project</p>
          <h2>{t("about.projectTitle")}</h2>
        </div>
        <p>{t("about.projectDesc")}</p>
      </section>
    </div>
  );
}
