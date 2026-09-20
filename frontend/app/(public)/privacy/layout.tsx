import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "นโยบายความเป็นส่วนตัว — Thai Performing Arts Recommendation System",
  description: "นโยบายความเป็นส่วนตัวของระบบแนะนำการแสดงนาฏศิลป์ไทย",
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
