import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "นโยบายความเป็นส่วนตัว — Thai Performing Arts Recommendation System",
  description: "นโยบายความเป็นส่วนตัวของระบบแนะนำการแสดงนาฏศิลป์ไทย",
};

export default function PrivacyPolicyPage() {
  return (
    <article className="legal-page section-stack" aria-labelledby="privacy-title">
      <header className="legal-hero">
        <p className="eyebrow">Privacy Policy</p>
        <h1 id="privacy-title">นโยบายความเป็นส่วนตัว</h1>
        <p>ปรับปรุงล่าสุด: 16 สิงหาคม 2569</p>
      </header>

      <section className="legal-card" aria-labelledby="privacy-overview">
        <h2 id="privacy-overview">ภาพรวม</h2>
        <p>
          Thai Performing Arts Recommendation System ให้ความสำคัญกับความเป็นส่วนตัว
          ของผู้ใช้ นโยบายนี้อธิบายข้อมูลที่ระบบเก็บ ใช้ และดูแลเมื่อคุณใช้งานเว็บไซต์
        </p>
      </section>

      <section className="legal-card" aria-labelledby="privacy-data">
        <h2 id="privacy-data">ข้อมูลที่ระบบอาจเก็บ</h2>
        <ul>
          <li>ข้อมูลบัญชี เช่น ชื่อ อีเมล และรูปโปรไฟล์ที่คุณอนุญาตให้ใช้</li>
          <li>ข้อมูลการเข้าสู่ระบบและข้อมูลที่จำเป็นต่อการรักษาความปลอดภัยของบัญชี</li>
          <li>รายการที่คุณบันทึก ให้คะแนน กดถูกใจ หรือใช้เพื่อรับคำแนะนำ</li>
          <li>ข้อมูลการใช้งานที่จำเป็นต่อการปรับปรุงประสิทธิภาพและความถูกต้องของระบบ</li>
        </ul>
      </section>

      <section className="legal-card" aria-labelledby="privacy-google">
        <h2 id="privacy-google">การเข้าสู่ระบบด้วย Google</h2>
        <p>
          หากคุณเลือกเข้าสู่ระบบด้วย Google ระบบจะใช้ข้อมูลพื้นฐานที่ Google ส่งให้
          ได้แก่รหัสประจำตัวของบัญชี อีเมล ชื่อ และรูปโปรไฟล์ตามที่ได้รับอนุญาต
          ระบบไม่ขอรหัสผ่าน Google และไม่เก็บ access token หรือ refresh token ของสมาชิก
        </p>
      </section>

      <section className="legal-card" aria-labelledby="privacy-use">
        <h2 id="privacy-use">วัตถุประสงค์การใช้ข้อมูล</h2>
        <ul>
          <li>สร้างและดูแลบัญชีผู้ใช้</li>
          <li>ให้บริการค้นหา การแนะนำ และการบันทึกประวัติการใช้งาน</li>
          <li>รักษาความปลอดภัย ตรวจสอบข้อผิดพลาด และป้องกันการใช้งานที่ไม่เหมาะสม</li>
          <li>ปรับปรุงระบบและประสบการณ์การใช้งานโดยใช้ข้อมูลเท่าที่จำเป็น</li>
        </ul>
      </section>

      <section className="legal-card" aria-labelledby="privacy-contact" aria-label="การติดต่อ">
        <h2 id="privacy-contact">การติดต่อ</h2>
        <p>
          หากมีคำถามเกี่ยวกับนโยบายนี้หรือการใช้ข้อมูล ติดต่อผู้ดูแลระบบได้ที่{" "}
          <a href="mailto:dpatt148@gmail.com">dpatt148@gmail.com</a>
        </p>
        <Link className="site-button ghost" href="/">
          กลับหน้าแรก
        </Link>
      </section>
    </article>
  );
}
