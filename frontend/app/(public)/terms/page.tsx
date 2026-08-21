import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ข้อกำหนดและเงื่อนไขการใช้งาน — Thai Performing Arts Recommendation System",
  description: "ข้อกำหนดและเงื่อนไขการใช้งานระบบแนะนำการแสดงนาฏศิลป์ไทย",
};

export default function TermsOfServicePage() {
  return (
    <article className="legal-page section-stack" aria-labelledby="terms-title">
      <header className="legal-hero">
        <p className="eyebrow">Terms of Service</p>
        <h1 id="terms-title">ข้อกำหนดและเงื่อนไขการใช้งาน</h1>
        <p>ปรับปรุงล่าสุด: 16 สิงหาคม 2569</p>
      </header>

      <section className="legal-card" aria-labelledby="terms-acceptance">
        <h2 id="terms-acceptance">การยอมรับเงื่อนไข</h2>
        <p>
          การเข้าถึงหรือใช้งาน Thai Performing Arts Recommendation System ถือว่าคุณอ่าน
          เข้าใจ และยอมรับข้อกำหนดเหล่านี้ หากไม่ยอมรับ กรุณาหยุดใช้งานเว็บไซต์
        </p>
      </section>

      <section className="legal-card" aria-labelledby="terms-service">
        <h2 id="terms-service">ลักษณะการให้บริการ</h2>
        <p>
          ระบบให้บริการค้นหาและแนะนำชุดการแสดงนาฏศิลป์ไทยเพื่อเป็นข้อมูลประกอบการเรียนรู้
          และการเลือกใช้งาน ผลการแนะนำเป็นข้อมูลจากระบบ ไม่ถือเป็นคำรับรองความเหมาะสม
          หรือผลลัพธ์สำหรับทุกสถานการณ์
        </p>
      </section>

      <section className="legal-card" aria-labelledby="terms-responsibility">
        <h2 id="terms-responsibility">ความรับผิดชอบของผู้ใช้</h2>
        <ul>
          <li>ให้ข้อมูลบัญชีที่ถูกต้อง และดูแลข้อมูลเข้าสู่ระบบของตนเอง</li>
          <li>ไม่ใช้ระบบเพื่อทำผิดกฎหมาย ละเมิดสิทธิผู้อื่น หรือรบกวนการทำงานของระบบ</li>
          <li>ไม่คัดลอก ดัดแปลง หรือเผยแพร่เนื้อหาโดยไม่มีสิทธิ์หรือไม่ได้รับอนุญาต</li>
          <li>ตรวจสอบความเหมาะสมของข้อมูลก่อนนำไปใช้ในกิจกรรมหรือการตัดสินใจจริง</li>
        </ul>
      </section>

      <section className="legal-card" aria-labelledby="terms-availability">
        <h2 id="terms-availability">การเปลี่ยนแปลงและความพร้อมใช้งาน</h2>
        <p>
          ผู้ดูแลอาจปรับปรุงเนื้อหา ฟังก์ชัน หรือข้อกำหนดเพื่อความเหมาะสมและความปลอดภัย
          ระบบอาจหยุดให้บริการชั่วคราวเพื่อบำรุงรักษา โดยจะแจ้งให้ทราบเมื่อทำได้
        </p>
      </section>

      <section className="legal-card" aria-labelledby="terms-contact" aria-label="ช่องทางติดต่อ">
        <h2 id="terms-contact">ช่องทางติดต่อ</h2>
        <p>
          หากพบปัญหาหรือมีข้อเสนอแนะ ติดต่อผู้ดูแลระบบได้ที่{" "}
          <a href="mailto:dpatt148@gmail.com">dpatt148@gmail.com</a>
        </p>
        <Link className="site-button ghost" href="/">
          กลับหน้าแรก
        </Link>
      </section>
    </article>
  );
}
