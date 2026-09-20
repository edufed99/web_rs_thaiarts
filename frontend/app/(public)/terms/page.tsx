"use client";

import Link from "next/link";
import React from "react";

import { useTranslation } from "@/contexts/LanguageContext";

export default function TermsOfServicePage() {
  const { locale } = useTranslation();
  const isEn = locale === "en";

  return (
    <article className="legal-page section-stack" aria-labelledby="terms-title">
      <header className="legal-hero">
        <p className="eyebrow">Terms of Service</p>
        <h1 id="terms-title">{isEn ? "Terms of Service" : "ข้อกำหนดและเงื่อนไขการใช้งาน"}</h1>
        <p>{isEn ? "Last updated: August 16, 2026" : "ปรับปรุงล่าสุด: 16 สิงหาคม 2569"}</p>
      </header>

      <section className="legal-card" aria-labelledby="terms-acceptance">
        <h2 id="terms-acceptance">{isEn ? "Acceptance of Terms" : "การยอมรับเงื่อนไข"}</h2>
        <p>
          {isEn
            ? "By accessing or using the Thai Performing Arts Recommendation System, you acknowledge that you have read, understood, and agreed to these terms. If you do not accept these terms, please discontinue use of the service."
            : "การเข้าถึงหรือใช้งาน Thai Performing Arts Recommendation System ถือว่าคุณอ่าน เข้าใจ และยอมรับข้อกำหนดเหล่านี้ หากไม่ยอมรับ กรุณาหยุดใช้งานเว็บไซต์"}
        </p>
      </section>

      <section className="legal-card" aria-labelledby="terms-service">
        <h2 id="terms-service">{isEn ? "Nature of the Service" : "ลักษณะการให้บริการ"}</h2>
        <p>
          {isEn
            ? "The system provides search and recommendation features for Thai performing arts to support cultural learning and performance selection. Recommendations are generated algorithmically and do not constitute a formal guarantee of suitability for every situation."
            : "ระบบให้บริการค้นหาและแนะนำชุดการแสดงนาฏศิลป์ไทยเพื่อเป็นข้อมูลประกอบการเรียนรู้ และการเลือกใช้งาน ผลการแนะนำเป็นข้อมูลจากระบบ ไม่ถือเป็นคำรับรองความเหมาะสม หรือผลลัพธ์สำหรับทุกสถานการณ์"}
        </p>
      </section>

      <section className="legal-card" aria-labelledby="terms-responsibility">
        <h2 id="terms-responsibility">{isEn ? "User Responsibilities" : "ความรับผิดชอบของผู้ใช้"}</h2>
        <ul>
          {isEn ? (
            <>
              <li>Provide accurate account information and maintain credential confidentiality</li>
              <li>Do not use the service for unlawful purposes, rights violations, or interference with system operations</li>
              <li>Do not duplicate, alter, or redistribute copyrighted content without authorization</li>
              <li>Verify performance suitability independently prior to actual commercial or ceremony execution</li>
            </>
          ) : (
            <>
              <li>ให้ข้อมูลบัญชีที่ถูกต้อง และดูแลข้อมูลเข้าสู่ระบบของตนเอง</li>
              <li>ไม่ใช้ระบบเพื่อทำผิดกฎหมาย ละเมิดสิทธิผู้อื่น หรือรบกวนการทำงานของระบบ</li>
              <li>ไม่คัดลอก ดัดแปลง หรือเผยแพร่เนื้อหาโดยไม่มีสิทธิ์หรือไม่ได้รับอนุญาต</li>
              <li>ตรวจสอบความเหมาะสมของข้อมูลก่อนนำไปใช้ในกิจกรรมหรือการตัดสินใจจริง</li>
            </>
          )}
        </ul>
      </section>

      <section className="legal-card" aria-labelledby="terms-availability">
        <h2 id="terms-availability">{isEn ? "Modifications & Availability" : "การเปลี่ยนแปลงและความพร้อมใช้งาน"}</h2>
        <p>
          {isEn
            ? "The administrators reserve the right to modify content, features, or terms to ensure quality and security. The service may undergo temporary maintenance, which will be communicated whenever feasible."
            : "ผู้ดูแลอาจปรับปรุงเนื้อหา ฟังก์ชัน หรือข้อกำหนดเพื่อความเหมาะสมและความปลอดภัย ระบบอาจหยุดให้บริการชั่วคราวเพื่อบำรุงรักษา โดยจะแจ้งให้ทราบเมื่อทำได้"}
        </p>
      </section>

      <section className="legal-card" aria-labelledby="terms-contact" aria-label={isEn ? "Contact" : "ช่องทางติดต่อ"}>
        <h2 id="terms-contact">{isEn ? "Contact Information" : "ช่องทางติดต่อ"}</h2>
        <p>
          {isEn
            ? "If you have questions or encounter issues regarding these terms, please contact the administrator at "
            : "หากพบปัญหาหรือมีข้อเสนอแนะ ติดต่อผู้ดูแลระบบได้ที่ "}
          <a href="mailto:dpatt148@gmail.com">dpatt148@gmail.com</a>
        </p>
        <Link className="site-button ghost" href="/">
          {isEn ? "Back to Home" : "กลับหน้าแรก"}
        </Link>
      </section>
    </article>
  );
}
