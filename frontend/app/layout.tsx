import type { Metadata } from "next";
import React from "react";

import { FrontendNav } from "@/components/FrontendNav";
import { SideMenu } from "@/components/SideMenu";
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
        <div className="app-shell">
          <SideMenu />
          <div className="app-main">
            <header className="app-topbar">
              <FrontendNav />
            </header>
            <main className="container">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
