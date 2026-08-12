import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "เกี่ยวกับผู้พัฒนาระบบ — Thai Performing Arts Recommendation System",
  description: "ข้อมูลผู้พัฒนาระบบแนะนำการแสดงนาฏศิลป์ไทย",
};

export default function AboutPage() {
  return (
    <div className="about-page section-stack">
      <section className="about-hero" aria-labelledby="developer-name">
        <div className="about-portrait-frame">
          <Image
            src="/img/system-developer-pichaya.jpg"
            alt="Pichaya Dumnil ผู้พัฒนาระบบ"
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
          <p className="about-role">ผู้พัฒนาระบบแนะนำการแสดงนาฏศิลป์ไทย</p>
          <p className="about-intro">
            ผู้พัฒนา Thai Performing Arts Recommendation System ระบบที่ช่วยให้ผู้ใช้ค้นหา
            และรับคำแนะนำชุดการแสดงนาฏศิลป์ไทยจากบริบท ความสนใจ และพฤติกรรมการใช้งาน
          </p>
          <div className="about-actions">
            <a className="site-button primary" href="mailto:dpatt148@gmail.com">
              ส่งอีเมลถึงผู้พัฒนา
            </a>
            <Link className="site-button ghost" href="/">
              กลับหน้าแรก
            </Link>
          </div>
        </div>
      </section>

      <section className="about-detail-grid" aria-label="ข้อมูลผู้พัฒนาระบบ">
        <article className="about-info-card">
          <span className="about-card-icon" aria-hidden="true">◎</span>
          <div>
            <h2>สถานที่ทำงาน</h2>
            <p>Faculty of Arts Education</p>
            <p>Bunditpatanasilpa Institute of Fine Arts</p>
            <p>Ministry of Culture</p>
          </div>
        </article>

        <article className="about-info-card">
          <span className="about-card-icon" aria-hidden="true">✉</span>
          <div>
            <h2>ข้อมูลติดต่อ</h2>
            <p>อีเมลสำหรับติดต่อเรื่องระบบ งานวิชาการ หรือข้อเสนอแนะ</p>
            <a href="mailto:dpatt148@gmail.com">dpatt148@gmail.com</a>
          </div>
        </article>
      </section>

      <section className="about-project-card">
        <div>
          <p className="eyebrow">About the Project</p>
          <h2>Thai Performing Arts Recommendation System</h2>
        </div>
        <p>
          โครงการนี้รวบรวมข้อมูลชุดการแสดงนาฏศิลป์ไทยและประยุกต์ระบบแนะนำ
          เพื่อช่วยให้ผู้ใช้ค้นพบการแสดงที่เหมาะกับโอกาสและความสนใจ พร้อมสนับสนุน
          การเข้าถึงองค์ความรู้ด้านศิลปวัฒนธรรมไทยผ่านเทคโนโลยีดิจิทัล
        </p>
      </section>
    </div>
  );
}
