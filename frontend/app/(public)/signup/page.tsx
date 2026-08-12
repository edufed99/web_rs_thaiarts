import React, { Suspense } from "react";

import { AuthForm } from "@/components/AuthForm";

export const metadata = {
  title: "สมัครสมาชิก — Thai Arts Recommender",
};

export default function SignupPage() {
  return (
    <div style={{ paddingTop: "1rem" }}>
      <Suspense fallback={<div>กำลังโหลด...</div>}>
        <AuthForm mode="signup" />
      </Suspense>
    </div>
  );
}