"use client";

import Link from "next/link";
import React from "react";

import { useTranslation } from "@/contexts/LanguageContext";

export default function PrivacyPolicyPage() {
  const { locale } = useTranslation();
  const isEn = locale === "en";

  return (
    <article className="legal-page section-stack" aria-labelledby="privacy-title">
      <header className="legal-hero">
        <p className="eyebrow">Privacy Policy</p>
        <h1 id="privacy-title">{isEn ? "Privacy Policy" : "นโยบายความเป็นส่วนตัว"}</h1>
        <p>{isEn ? "Last updated: August 16, 2026" : "ปรับปรุงล่าสุด: 16 สิงหาคม 2569"}</p>
      </header>

      <section className="legal-card" aria-labelledby="privacy-overview">
        <h2 id="privacy-overview">{isEn ? "Overview" : "ภาพรวม"}</h2>
        <p>
          {isEn
            ? "The Thai Performing Arts Recommendation System respects and prioritizes user privacy. This policy describes how data is collected, used, and protected when you interact with this website."
            : "Thai Performing Arts Recommendation System ให้ความสำคัญกับความเป็นส่วนตัวของผู้ใช้ นโยบายนี้อธิบายข้อมูลที่ระบบเก็บ ใช้ และดูแลเมื่อคุณใช้งานเว็บไซต์"}
        </p>
      </section>

      <section className="legal-card" aria-labelledby="privacy-data">
        <h2 id="privacy-data">{isEn ? "Data We Collect" : "ข้อมูลที่ระบบอาจเก็บ"}</h2>
        <ul>
          {isEn ? (
            <>
              <li>Account information such as your name, email, and authorized profile picture</li>
              <li>Authentication metadata necessary to secure your account</li>
              <li>Performances you save, rate, like, or inspect to generate recommendations</li>
              <li>Interaction metrics necessary to maintain system performance and recommendation quality</li>
            </>
          ) : (
            <>
              <li>ข้อมูลบัญชี เช่น ชื่อ อีเมล และรูปโปรไฟล์ที่คุณอนุญาตให้ใช้</li>
              <li>ข้อมูลการเข้าสู่ระบบและข้อมูลที่จำเป็นต่อการรักษาความปลอดภัยของบัญชี</li>
              <li>รายการที่คุณบันทึก ให้คะแนน กดถูกใจ หรือใช้เพื่อรับคำแนะนำ</li>
              <li>ข้อมูลการใช้งานที่จำเป็นต่อการปรับปรุงประสิทธิภาพและความถูกต้องของระบบ</li>
            </>
          )}
        </ul>
      </section>

      <section className="legal-card" aria-labelledby="privacy-google">
        <h2 id="privacy-google">{isEn ? "Google Sign-In" : "การเข้าสู่ระบบด้วย Google"}</h2>
        <p>
          {isEn
            ? "If you choose to sign in with Google, we only use standard profile claims provided by Google (identifier, email, name, avatar). The system never requests your Google account password and does not store sensitive Google access or refresh tokens in your browser."
            : "หากคุณเลือกเข้าสู่ระบบด้วย Google ระบบจะใช้ข้อมูลพื้นฐานที่ Google ส่งให้ ได้แก่รหัสประจำตัวของบัญชี อีเมล ชื่อ และรูปโปรไฟล์ตามที่ได้รับอนุญาต ระบบไม่ขอรหัสผ่าน Google และไม่เก็บ access token หรือ refresh token ของสมาชิก"}
        </p>
      </section>

      <section className="legal-card" aria-labelledby="privacy-use">
        <h2 id="privacy-use">{isEn ? "Purpose of Data Processing" : "วัตถุประสงค์การใช้ข้อมูล"}</h2>
        <ul>
          {isEn ? (
            <>
              <li>Create, authenticate, and manage your user account</li>
              <li>Deliver search, recommendation, and activity history features</li>
              <li>Ensure security, diagnose anomalies, and prevent fraudulent activity</li>
              <li>Continuously improve recommendation algorithms using minimized data</li>
            </>
          ) : (
            <>
              <li>สร้างและดูแลบัญชีผู้ใช้</li>
              <li>ให้บริการค้นหา การแนะนำ และการบันทึกประวัติการใช้งาน</li>
              <li>รักษาความปลอดภัย ตรวจสอบข้อผิดพลาด และป้องกันการใช้งานที่ไม่เหมาะสม</li>
              <li>ปรับปรุงระบบและประสบการณ์การใช้งานโดยใช้ข้อมูลเท่าที่จำเป็น</li>
            </>
          )}
        </ul>
      </section>

      <section className="legal-card" aria-labelledby="privacy-contact" aria-label={isEn ? "Contact" : "การติดต่อ"}>
        <h2 id="privacy-contact">{isEn ? "Contact Us" : "การติดต่อ"}</h2>
        <p>
          {isEn
            ? "If you have questions about this policy or personal data handling, please contact the administrator at "
            : "หากมีคำถามเกี่ยวกับนโยบายนี้หรือการใช้ข้อมูล ติดต่อผู้ดูแลระบบได้ที่ "}
          <a href="mailto:dpatt148@gmail.com">dpatt148@gmail.com</a>
        </p>
        <Link className="site-button ghost" href="/">
          {isEn ? "Back to Home" : "กลับหน้าแรก"}
        </Link>
      </section>
    </article>
  );
}
