import Link from "next/link";
import React from "react";

/**
 * Site-wide footer used by every public page. Four columns mirror the
 * mockup homepage: brand blurb, primary nav, help links, contact info.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer-inner">
        <div className="site-footer-col brand-col">
          <Link href="/" className="site-footer-brand">
            <span className="site-brand-mark" aria-hidden="true">น</span>
            <strong>นาฏศิลป์ไทย</strong>
          </Link>
          <p className="site-footer-tagline">
            แหล่งรวบรวมชุดการแสดงนาฏศิลป์ไทยชุดใหญ่ในงานพิธี เรียนรู้ประวัติศาสตร์
            ค้นหาชุดที่เหมาะกับทุกโอกาส ผ่านอัลกอริทึมแนะนำและฐานข้อมูลที่พัฒนาโดยคนไทย
          </p>
          <div className="site-footer-social" aria-label="ช่องทางโซเชียล">
            <a href="#" aria-label="Facebook">f</a>
            <a href="#" aria-label="YouTube">▶</a>
            <a href="#" aria-label="Instagram">◎</a>
            <a href="#" aria-label="Line">●</a>
          </div>
        </div>

        <div className="site-footer-col">
          <h3>เมนูหลัก</h3>
          <ul>
            <li><Link href="/">หน้าแรก</Link></li>
            <li><Link href="/items">ค้นหาชุดการแสดง</Link></li>
            <li><Link href="/recommend">รับคำแนะนำเฉพาะบุคคล</Link></li>
            <li><Link href="/profile">ข้อมูลผู้ใช้</Link></li>
            <li><Link href="/login">เข้าสู่ระบบ</Link></li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h3>ช่วยเหลือ</h3>
          <ul>
            <li>วิธีใช้งานระบบ</li>
            <li>คำถามที่พบบ่อย</li>
            <li><Link href="/about">ติดต่อผู้พัฒนาระบบ</Link></li>
            <li>รายงานปัญหาการใช้งาน</li>
            <li><Link href="/privacy">นโยบายความเป็นส่วนตัว</Link></li>
            <li><Link href="/terms">ข้อกำหนดการใช้งาน</Link></li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h3>ติดต่อเรา</h3>
          <ul className="contact">
            <li>✉ <a href="mailto:dpatt148@gmail.com">dpatt148@gmail.com</a></li>
            <li>📍 Faculty of Arts Education, Bunditpatanasilpa Institute of Fine Arts, Ministry of Culture</li>
          </ul>
        </div>
      </div>

      <div className="site-footer-bottom">
        <small>© 2026 นาฏศิลป์ไทย — สงวนลิขสิทธิ์ทั้งหมด</small>
      </div>
    </footer>
  );
}
