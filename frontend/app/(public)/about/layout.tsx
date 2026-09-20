import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "เกี่ยวกับผู้พัฒนาระบบ — Thai Performing Arts Recommendation System",
  description: "ข้อมูลผู้พัฒนาระบบแนะนำการแสดงนาฏศิลป์ไทย",
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
