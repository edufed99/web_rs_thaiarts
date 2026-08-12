import React from "react";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Public layout — used by every marketing / browse / auth page.
 *
 * Renders the top navigation + footer defined in the mockup. The admin
 * tools keep their own sidebar via ``app/(admin)/layout.tsx``.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="site-main">{children}</main>
      <SiteFooter />
    </div>
  );
}