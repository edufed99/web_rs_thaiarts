import type { Metadata } from "next";
import Link from "next/link";
import React from "react";

import { FrontendNav } from "@/components/FrontendNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ThaiPerform AI",
  description: "ระบบแนะนำชุดการแสดงไทยด้วย Next.js และ FastAPI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>
        <header className="app-topbar">
          <Link className="brand" href="/">
            <span className="brand-mark"><span>TP</span></span>
            <span>ThaiPerform AI</span>
          </Link>
          <FrontendNav />
        </header>
        <div className="app-shell">
          <aside className="side-menu" aria-label="เมนูหลักของระบบ">
            <Link href="/"><span>01</span><b>หน้าหลัก</b></Link>
            <Link href="/items"><span>02</span><b>คลังชุดการแสดง</b></Link>
            <Link href="/recommend"><span>03</span><b>ค้นหาชุดการแสดง</b></Link>
            <Link href="/#system-summary"><span>04</span><b>วิธีทำงานของระบบ</b></Link>
            <div className="side-menu-title">Research tools</div>
            <Link href="/admin/items"><span>05</span><b>Dashboard ผู้วิจัย</b></Link>
            <Link href="http://127.0.0.1:8080/docs"><span>API</span><b>Swagger docs</b></Link>
          </aside>
          <main className="container">{children}</main>
        </div>
      </body>
    </html>
  );
}
