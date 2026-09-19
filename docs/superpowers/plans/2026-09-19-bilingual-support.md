# Bilingual Support (Thai / English) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement bilingual (Thai and English) language support across both the public frontend and administrator portal with zero regression risk to existing Thai production URLs.

**Architecture:** A lightweight in-house localization engine using strictly typed dictionaries (`locales/th.ts`, `locales/en.ts`), a React `LanguageContext` hook (`useTranslation()`), SSR cookie pre-fetching in `app/layout.tsx` for zero-flicker rendering, and unified `LanguageSwitcher` pill toggles in the public header and admin topbar.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Node.js built-in `node:test` runner.

**Spec:** `docs/superpowers/specs/2026-09-19-bilingual-support-design.md`

## Global Constraints
- Target workspace: `frontend/` directory in `C:\Users\Pichaya\Downloads\web_appRS1`.
- URL paths must remain unchanged (`/`, `/items`, `/admin/...`); do NOT introduce `/en/` or route rewriting.
- Zero new runtime external npm dependencies.
- Fallback to Thai must be automatic and safe if any English key is missing or blank.
- TypeScript check (`npm run type-check`) and Next.js build (`npm run build`) must pass with 0 errors.

---

### Task 1: Translation Dictionaries & Localization Engine

**Files:**
- Create: `frontend/locales/th.ts`
- Create: `frontend/locales/en.ts`
- Create: `frontend/locales/index.ts`
- Create: `frontend/tests/locales.test.mjs`

**Interfaces:**
- Produces:
  - `export type Locale = "th" | "en"`
  - `export type TranslationDictionary`
  - `export function getDictionary(locale: Locale): TranslationDictionary`
  - `export function translate(dict: TranslationDictionary, key: string, fallbackDict?: TranslationDictionary): string`

- [ ] **Step 1: Write failing test for dictionaries and translation resolver**

Create `frontend/tests/locales.test.mjs`:
```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../locales/en.js";
import { getDictionary, translate } from "../locales/index.js";
import { th } from "../locales/th.js";

test("dictionaries have identical keys across th and en", () => {
  assert.ok(th.nav.home);
  assert.ok(en.nav.home);
  assert.strictEqual(en.nav.home, "Home");
  assert.strictEqual(th.nav.home, "หน้าแรก");
});

test("translate resolves nested keys correctly", () => {
  const dict = getDictionary("en");
  const translated = translate(dict, "nav.catalog");
  assert.strictEqual(translated, "Performances");
});

test("translate falls back to Thai if key is missing in English", () => {
  const customEn = { nav: { home: "Home" } };
  const translated = translate(customEn, "nav.about", th);
  assert.strictEqual(translated, "เกี่ยวกับเรา");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/tests/locales.test.mjs`
Expected: FAIL (Cannot find module '../locales/index.js')

- [ ] **Step 3: Implement `locales/th.ts`, `locales/en.ts`, and `locales/index.ts`**

Create `frontend/locales/th.ts` with comprehensive Thai strings:
```typescript
export const th = {
  common: {
    loading: "กำลังโหลด...",
    save: "บันทึก",
    cancel: "ยกเลิก",
    delete: "ลบ",
    edit: "แก้ไข",
    back: "ย้อนกลับ",
    search: "ค้นหา",
    confirm: "ยืนยัน",
    close: "ปิด",
    viewAll: "ดูทั้งหมด",
    noData: "ไม่พบข้อมูล",
    all: "ทั้งหมด",
    status: "สถานะ",
    active: "เปิดใช้งาน",
    inactive: "ปิดใช้งาน",
  },
  nav: {
    brand: "ศิลปะการแสดงไทย",
    home: "หน้าแรก",
    catalog: "ค้นหาชุดการแสดง",
    categories: "หมวดหมู่",
    about: "เกี่ยวกับเรา",
    profile: "ข้อมูลผู้ใช้",
    login: "เข้าสู่ระบบ",
    signup: "ลงทะเบียน",
    logout: "ออกจากระบบ",
    adminDashboard: "ระบบจัดการ (Admin)",
    menu: "เมนู",
  },
  home: {
    heroTitle: "สืบสานและค้นพบคุณค่าศิลปะการแสดงไทย",
    heroSubtitle: "ระบบสืบค้นและแนะนำชุดการแสดงไทยแบบอัจฉริยะ ตอบโจทย์ทุกโอกาสและบริบทการจัดงาน",
    browseAll: "ค้นหาชุดการแสดงทั้งหมด",
    recommendedTitle: "ชุดการแสดงแนะนำสำหรับคุณ",
    popularTitle: "ชุดการแสดงยอดนิยม",
    exploreCategories: "สำรวจตามหมวดหมู่ศิลปะ",
  },
  items: {
    searchPlaceholder: "พิมพ์ชื่อชุดการแสดง หรือคำสำคัญ...",
    filterCategory: "หมวดหมู่",
    filterDuration: "ระยะเวลาการแสดง",
    filterPerformers: "จำนวนผู้แสดง",
    filterOccasion: "โอกาสที่ใช้แสดง",
    allCategories: "ทุกหมวดหมู่",
    sortRecommended: "แนะนำสำหรับคุณ",
    sortPopular: "ยอดนิยม",
    sortName: "ตามชื่อการแสดง",
    noResults: "ไม่พบชุดการแสดงที่ตรงกับเงื่อนไข",
    minutes: "นาที",
    people: "คน",
    details: "ดูรายละเอียด",
  },
  itemDetail: {
    category: "หมวดหมู่",
    duration: "ระยะเวลาการแสดง",
    performers: "จำนวนผู้แสดง",
    cost: "ประมาณการค่าใช้จ่าย",
    occasions: "โอกาสและบริบทที่เหมาะสม",
    keywords: "คำสำคัญที่เกี่ยวข้อง",
    videoPreview: "วิดีโอตัวอย่างการแสดง",
    similarTitle: "ชุดการแสดงที่ใกล้เคียงกัน",
    reviewsTitle: "การประเมินและความคิดเห็น",
    rateThis: "ให้คะแนนชุดการแสดงนี้",
    favorite: "บันทึกในรายการโปรด",
    favorited: "บันทึกแล้ว",
  },
  admin: {
    title: "ศูนย์บริหารจัดการระบบ",
    dashboard: "แดชบอร์ดสรุปผล",
    itemManagement: "จัดการชุดการแสดง",
    addNewItem: "เพิ่มชุดการแสดงใหม่",
    analytics: "สถิติและการวิเคราะห์",
    emailSettings: "การตั้งค่าอีเมล",
    publication: "เผยแพร่ Artifact Recommender",
    tableId: "รหัส",
    tableName: "ชื่อชุดการแสดง",
    tableCategory: "หมวดหมู่",
    tableStatus: "สถานะ",
    tablePublished: "สถานะเผยแพร่",
    tableActions: "การจัดการ",
    totalItems: "ชุดการแสดงทั้งหมด",
    totalMembers: "สมาชิกในระบบ",
    totalInteractions: "การมีปฏิสัมพันธ์รวม",
  },
  footer: {
    description: "ระบบสืบค้นและแนะนำศิลปะการแสดงไทย เพื่อการอนุรักษ์และเผยแพร่มรดกทางวัฒนธรรม",
    quickLinks: "ลิงก์ด่วน",
    privacy: "นโยบายความเป็นส่วนตัว",
    terms: "ข้อกำหนดการใช้งาน",
    contact: "ติดต่อสอบถาม",
    copyright: "สงวนลิขสิทธิ์ พ.ศ. 2569 สถาบันบัณฑิตพัฒนศิลป์",
  },
  consent: {
    message: "เว็บไซต์นี้ใช้คุกกี้เพื่อเพิ่มประสิทธิภาพและประสบการณ์ที่ดีในการใช้งาน",
    accept: "ยอมรับทั้งหมด",
    reject: "ปฏิเสธ",
  },
};

export type TranslationDictionary = typeof th;
```

Create `frontend/locales/en.ts`:
```typescript
import type { TranslationDictionary } from "./th";

export const en: TranslationDictionary = {
  common: {
    loading: "Loading...",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    back: "Back",
    search: "Search",
    confirm: "Confirm",
    close: "Close",
    viewAll: "View All",
    noData: "No data found",
    all: "All",
    status: "Status",
    active: "Active",
    inactive: "Inactive",
  },
  nav: {
    brand: "Thai Performing Arts",
    home: "Home",
    catalog: "Performances",
    categories: "Categories",
    about: "About",
    profile: "Profile",
    login: "Sign In",
    signup: "Register",
    logout: "Sign Out",
    adminDashboard: "Admin Portal",
    menu: "Menu",
  },
  home: {
    heroTitle: "Preserve and Discover Thai Performing Arts",
    heroSubtitle: "Intelligent recommendation system for traditional Thai arts tailored for every occasion and context.",
    browseAll: "Browse All Performances",
    recommendedTitle: "Recommended For You",
    popularTitle: "Popular Performances",
    exploreCategories: "Explore By Category",
  },
  items: {
    searchPlaceholder: "Search performances or keywords...",
    filterCategory: "Category",
    filterDuration: "Duration",
    filterPerformers: "Performers",
    filterOccasion: "Occasion",
    allCategories: "All Categories",
    sortRecommended: "Recommended",
    sortPopular: "Most Popular",
    sortName: "Alphabetical",
    noResults: "No performances match your search criteria",
    minutes: "minutes",
    people: "performers",
    details: "View Details",
  },
  itemDetail: {
    category: "Category",
    duration: "Duration",
    performers: "Performers Count",
    cost: "Estimated Budget",
    occasions: "Suitable Occasions",
    keywords: "Related Keywords",
    videoPreview: "Video Preview",
    similarTitle: "Similar Performances",
    reviewsTitle: "Ratings & Reviews",
    rateThis: "Rate this performance",
    favorite: "Add to Favorites",
    favorited: "Saved",
  },
  admin: {
    title: "System Administration",
    dashboard: "Dashboard",
    itemManagement: "Performance Catalogue",
    addNewItem: "Add Performance",
    analytics: "Analytics & Reports",
    emailSettings: "Email Settings",
    publication: "Publish Artifact Recommender",
    tableId: "ID",
    tableName: "Performance Name",
    tableCategory: "Category",
    tableStatus: "Status",
    tablePublished: "Published Status",
    tableActions: "Actions",
    totalItems: "Total Performances",
    totalMembers: "Total Members",
    totalInteractions: "Total Interactions",
  },
  footer: {
    description: "Intelligent Thai Performing Arts recommendation system dedicated to preserving and promoting cultural heritage.",
    quickLinks: "Quick Links",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    contact: "Contact Us",
    copyright: "All Rights Reserved 2026 Bunditpatanasilpa Institute.",
  },
  consent: {
    message: "This website uses cookies to enhance your browsing experience and analyze site traffic.",
    accept: "Accept All",
    reject: "Decline",
  },
};
```

Create `frontend/locales/index.ts`:
```typescript
import { en } from "./en";
import { th, type TranslationDictionary } from "./th";

export type Locale = "th" | "en";
export { en, th, type TranslationDictionary };

export function getDictionary(locale: Locale): TranslationDictionary {
  return locale === "en" ? en : th;
}

export function translate(
  dict: any,
  keyPath: string,
  fallbackDict: any = th,
): string {
  const keys = keyPath.split(".");
  let val = dict;
  for (const k of keys) {
    if (val && typeof val === "object" && k in val) {
      val = val[k];
    } else {
      val = undefined;
      break;
    }
  }
  if (typeof val === "string" && val.trim().length > 0) {
    return val;
  }
  // Fallback
  let fallbackVal = fallbackDict;
  for (const k of keys) {
    if (fallbackVal && typeof fallbackVal === "object" && k in fallbackVal) {
      fallbackVal = fallbackVal[k];
    } else {
      fallbackVal = undefined;
      break;
    }
  }
  return typeof fallbackVal === "string" ? fallbackVal : keyPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/tests/locales.test.mjs`
Expected: PASS (All 3 tests pass)

- [ ] **Step 5: Commit**

```bash
git add frontend/locales frontend/tests/locales.test.mjs
git commit -m "feat(i18n): add typed dictionaries and translation resolver"
```

---

### Task 2: Language Context & SSR Cookie Hydration

**Files:**
- Create: `frontend/contexts/LanguageContext.tsx`
- Modify: `frontend/app/layout.tsx`

**Interfaces:**
- Consumes: `Locale`, `getDictionary`, `translate` from `frontend/locales/index.ts`
- Produces:
  - `<LanguageProvider initialLocale={locale}>`
  - `useTranslation()` returning `{ locale, setLocale, t, dict }`

- [ ] **Step 1: Implement `LanguageContext.tsx`**

Create `frontend/contexts/LanguageContext.tsx`:
```tsx
"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  type Locale,
  type TranslationDictionary,
  getDictionary,
  translate,
} from "@/locales";

export const LOCALE_COOKIE_KEY = "NEXT_LOCALE";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (keyPath: string) => string;
  dict: TranslationDictionary;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({
  children,
  initialLocale = "th",
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    // Check localStorage on mount if different
    const saved = localStorage.getItem(LOCALE_COOKIE_KEY) as Locale | null;
    if (saved && (saved === "th" || saved === "en") && saved !== locale) {
      setLocaleState(saved);
      document.cookie = `${LOCALE_COOKIE_KEY}=${saved}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
    }
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(LOCALE_COOKIE_KEY, newLocale);
    document.cookie = `${LOCALE_COOKIE_KEY}=${newLocale}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  }, []);

  const dict = getDictionary(locale);

  const t = useCallback(
    (keyPath: string) => {
      return translate(dict, keyPath);
    },
    [dict],
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, dict }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Update `frontend/app/layout.tsx` for SSR Cookie reading**

Modify `frontend/app/layout.tsx` to read the cookie and pass `initialLocale`:
```tsx
import { cookies } from "next/headers";
import { LanguageProvider, LOCALE_COOKIE_KEY } from "@/contexts/LanguageContext";
import type { Locale } from "@/locales";

// inside RootLayout:
const cookieStore = cookies();
const cookieLocale = cookieStore.get(LOCALE_COOKIE_KEY)?.value;
const initialLocale: Locale = cookieLocale === "en" ? "en" : "th";

return (
  <html lang={initialLocale}>
    <body>
      <LanguageProvider initialLocale={initialLocale}>
        {children}
      </LanguageProvider>
    </body>
  </html>
);
```

- [ ] **Step 3: Run type-check to verify compilation**

Run: `cd frontend && npm run type-check`
Expected: PASS (0 errors)

- [ ] **Step 4: Commit**

```bash
git add frontend/contexts/LanguageContext.tsx frontend/app/layout.tsx
git commit -m "feat(i18n): add LanguageProvider with SSR cookie hydration"
```

---

### Task 3: LanguageSwitcher UI Component

**Files:**
- Create: `frontend/components/LanguageSwitcher.tsx`
- Modify: `frontend/app/globals.css` (add styling for switcher pill)

**Interfaces:**
- Consumes: `useTranslation()` from `@/contexts/LanguageContext`
- Produces: `<LanguageSwitcher className?: string />`

- [ ] **Step 1: Implement `LanguageSwitcher.tsx`**

Create `frontend/components/LanguageSwitcher.tsx`:
```tsx
"use client";

import React from "react";
import { useTranslation } from "@/contexts/LanguageContext";

interface Props {
  className?: string;
  variant?: "header" | "admin" | "mobile";
}

export function LanguageSwitcher({ className = "", variant = "header" }: Props) {
  const { locale, setLocale } = useTranslation();

  return (
    <div
      role="group"
      aria-label="Language selection"
      className={`lang-switcher-pill ${variant} ${className}`.trim()}
    >
      <button
        type="button"
        aria-pressed={locale === "th"}
        className={`lang-btn ${locale === "th" ? "active" : ""}`}
        onClick={() => setLocale("th")}
      >
        TH
      </button>
      <span className="lang-divider">|</span>
      <button
        type="button"
        aria-pressed={locale === "en"}
        className={`lang-btn ${locale === "en" ? "active" : ""}`}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS rules to `frontend/app/globals.css`**

Add styling for `.lang-switcher-pill`:
```css
.lang-switcher-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 9999px;
  font-size: 0.8rem;
  font-weight: 600;
  user-select: none;
}

.lang-switcher-pill.admin {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #334155;
}

.lang-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 9999px;
  color: inherit;
  opacity: 0.7;
  transition: all 0.15s ease;
}

.lang-btn:hover {
  opacity: 1;
}

.lang-btn.active {
  opacity: 1;
  background: var(--color-primary, #b45309);
  color: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.lang-divider {
  opacity: 0.4;
  font-size: 0.75rem;
}
```

- [ ] **Step 3: Run type-check**

Run: `cd frontend && npm run type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/components/LanguageSwitcher.tsx frontend/app/globals.css
git commit -m "feat(i18n): create LanguageSwitcher component and styles"
```

---

### Task 4: Public Chrome Integration (`SiteHeader`, `SiteFooter`, `ConsentBanner`)

**Files:**
- Modify: `frontend/components/SiteHeader.tsx`
- Modify: `frontend/components/SiteFooter.tsx`
- Modify: `frontend/components/ConsentBanner.tsx`

**Interfaces:**
- Uses `useTranslation()` to dynamically render navigation labels, copyright, and embed `<LanguageSwitcher />`.

- [ ] **Step 1: Update `SiteHeader.tsx`**
  - Replace static `PRIMARY_NAV` array with localized items using `t('nav.home')`, etc.
  - Add `<LanguageSwitcher variant="header" />` in desktop header next to auth action.
  - Add `<LanguageSwitcher variant="mobile" />` inside the mobile drawer menu.

- [ ] **Step 2: Update `SiteFooter.tsx`**
  - Localize quick links, description, and copyright notice using `t('footer.*')`.

- [ ] **Step 3: Update `ConsentBanner.tsx`**
  - Localize message, Accept, and Reject button labels using `t('consent.*')`.

- [ ] **Step 4: Run type check & build validation**

Run: `cd frontend && npm run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/SiteHeader.tsx frontend/components/SiteFooter.tsx frontend/components/ConsentBanner.tsx
git commit -m "feat(i18n): integrate language switcher and translations in public chrome"
```

---

### Task 5: Admin Chrome & Portal Integration (`FrontendNav`, `SideMenu`, Admin Views)

**Files:**
- Modify: `frontend/components/FrontendNav.tsx`
- Modify: `frontend/components/SideMenu.tsx`
- Modify: `frontend/app/(admin)/dashboard/page.tsx`
- Modify: `frontend/app/(admin)/admin/items/page.tsx`

**Interfaces:**
- Embed `<LanguageSwitcher variant="admin" />` on the admin topbar.
- Translate sidebar links and table headers in Admin Catalogue.

- [ ] **Step 1: Update `FrontendNav.tsx`**
  - Add `<LanguageSwitcher variant="admin" />` to the right-side actions of the admin topbar.
  - Translate greeting or logout labels if applicable.

- [ ] **Step 2: Update `SideMenu.tsx`**
  - Translate menu labels ("แดชบอร์ด", "จัดการชุดการแสดง", "สถิติ", "เผยแพร่") using `t('admin.*')`.

- [ ] **Step 3: Update `app/(admin)/dashboard/page.tsx` & `admin/items/page.tsx`**
  - Translate main table headers (ID, Name, Category, Status, Actions) and summary cards.

- [ ] **Step 4: Run type check & build**

Run: `cd frontend && npm run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/FrontendNav.tsx frontend/components/SideMenu.tsx frontend/app/(admin)/
git commit -m "feat(i18n): integrate language switcher and translations in admin portal"
```

---

### Task 6: Public Views Integration (Home & Catalog Search)

**Files:**
- Modify: `frontend/app/(public)/page.tsx`
- Modify: `frontend/app/(public)/items/page.tsx`

**Interfaces:**
- Localize hero section, filter dropdown labels, search placeholder, and empty state.

- [ ] **Step 1: Update `app/(public)/page.tsx`**
  - Localize Hero Title, Subtitle, "ค้นหาชุดการแสดงทั้งหมด" button, and section titles using `t('home.*')`.

- [ ] **Step 2: Update `app/(public)/items/page.tsx`**
  - Localize search input placeholder, filter label names (หมวดหมู่, ระยะเวลา, จำนวนผู้แสดง), and sorting options using `t('items.*')`.

- [ ] **Step 3: Run type check**

Run: `cd frontend && npm run type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/app/(public)/page.tsx frontend/app/(public)/items/page.tsx
git commit -m "feat(i18n): localize public homepage and performance catalog view"
```

---

### Task 7: Verification & Production Build Audit

**Files:**
- Verify: Full codebase

- [ ] **Step 1: Run unit tests**

Run: `node --test frontend/tests/locales.test.mjs`
Expected: All tests PASS.

- [ ] **Step 2: Run core foundation test suite**

Run: `npm --prefix frontend run test:deployment`
Expected: PASS.

- [ ] **Step 3: Run TypeScript type-check**

Run: `npm --prefix frontend run type-check`
Expected: 0 errors.

- [ ] **Step 4: Run full Next.js production build**

Run: `npm --prefix frontend run build`
Expected: Build successful, all routes statically optimized or server-rendered cleanly without errors.

- [ ] **Step 5: Final Git Status Verification & Commit**

Verify clean working directory and ready for Docker build/deployment.
