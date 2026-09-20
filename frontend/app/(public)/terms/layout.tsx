import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "ข้อกำหนดและเงื่อนไขการใช้งาน — Thai Performing Arts Recommendation System",
  description: "ข้อกำหนดและเงื่อนไขการใช้งานระบบแนะนำการแสดงนาฏศิลป์ไทย",
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
