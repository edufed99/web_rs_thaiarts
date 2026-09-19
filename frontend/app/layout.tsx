import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import { cookies } from "next/headers";
import React from "react";

import { LanguageProvider } from "@/contexts/LanguageContext";
import { type Locale, LOCALE_COOKIE_KEY } from "@/locales";

import "./globals.css";

// Self-hosted Thai font. Without this the app renders Thai text with the
// OS default, which is absent on many machines and degrades gracefully to a
// Latin-only font. Display=swap keeps the page interactive while Noto loads.
const notoThai = Noto_Sans_Thai({
  subsets: ["thai"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-thai",
});

export const metadata: Metadata = {
  title: "ThaiPerform AI",
  description: "ระบบแนะนำชุดการแสดงไทยด้วย Next.js และ FastAPI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_KEY)?.value;
  const initialLocale: Locale = cookieLocale === "en" ? "en" : "th";

  // Each route group ((public) / (admin)) renders its own chrome. The root
  // layout just wires up the font + global CSS.
  return (
    <html lang={initialLocale} className={notoThai.variable}>
      <body className={notoThai.className}>
        <LanguageProvider initialLocale={initialLocale}>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
