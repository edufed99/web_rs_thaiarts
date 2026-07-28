import React, { Suspense } from "react";

import { AuthForm } from "@/components/AuthForm";

export const metadata = {
  title: "เข้าสู่ระบบ — Thai Arts Recommender",
};

export default function LoginPage() {
  return (
    <div style={{ paddingTop: "1rem" }}>
      <Suspense fallback={<div>กำลังโหลด...</div>}>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}