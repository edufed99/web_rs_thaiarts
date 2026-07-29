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
          <main className="container">{children}</main>
        </div>
      </body>
    </html>
  );
}
