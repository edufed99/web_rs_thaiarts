import React from "react";

import { FrontendNav } from "@/components/FrontendNav";
import { SideMenu } from "@/components/SideMenu";

/**
 * Admin layout — preserves the existing left-sidebar + topbar chrome so
 * dashboard / admin-tools pages keep their dense, action-oriented layout.
 *
 * The marketing redesign (``app/(public)/layout.tsx``) replaced the sidebar
 * with a top nav + footer — see Phase 1 plan.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <SideMenu />
      <div className="app-main">
        <header className="app-topbar">
          <FrontendNav />
        </header>
        <main className="container">{children}</main>
      </div>
    </div>
  );
}