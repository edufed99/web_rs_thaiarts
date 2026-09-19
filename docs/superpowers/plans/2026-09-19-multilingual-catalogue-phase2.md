# Multilingual Catalogue & Recommendation Journey (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 bilingual support across PostgreSQL database, Next.js server APIs, Admin management, and the Public Recommendation Journey, ensuring all performance details, categories, occasions, and keywords display in English when switched to `EN`, with zero regressions to the recommendation algorithms and Thai production deployment.

**Architecture:** Extend existing PostgreSQL tables (`items`, `contexts`, `keywords`, `taxonomy_nodes`) with dedicated nullable `*_en` columns via TypeORM migrations; pre-seed authoritative English translations referencing *WIPHITSILPA (วิพิธศิลปา)*; update server APIs and search matchers; update the frontend with a central localization helper; localize the member recommendation journey (`/recommend` and `/results`) preserving exact numeric ID contracts; and provide bilingual inputs in the Admin portal.

**Tech Stack:** Next.js 14 (App Router), TypeScript, PostgreSQL 18, TypeORM, React 18, Node.js test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-09-19-multilingual-catalogue-phase2-design.md`](file:///C:/Users/Pichaya/Downloads/web_appRS1/docs/superpowers/specs/2026-09-19-multilingual-catalogue-phase2-design.md)

## Global Constraints
- Invariant 1: Working Directory Rule — all changes inside `frontend/` and project root. Never modify `../web_appRS/`.
- Invariant 2: Zero Algorithmic Drift — recommendation algorithms, scoring equations, and numeric ID parameters (`context_id: number`, `keyword_ids: number[]`, `artifact_item_id: number`) remain completely identical.
- Invariant 3: Zero Schema Breakage — existing Thai columns (`name`, `description`, etc.) remain non-nullable and intact. All `*_en` columns are nullable strings.
- Invariant 4: Explicit Migrations Only — schema changes must use TypeORM migrations (`synchronize: false`).
- Invariant 5: Language Preference — respect `NEXT_LOCALE` cookie via `LanguageContext` (`th` | `en`).

---

### Task 1: TypeORM Migration & Entities for Bilingual Columns

**Files:**
- Create: `frontend/db/migrations/1787400000000-AddBilingualCatalogueColumns.ts`
- Modify: `frontend/db/entities/Catalogue.ts:1-125`
- Test: `frontend/tests/catalogue.test.mjs`

**Interfaces:**
- Consumes: TypeORM `MigrationInterface`, `QueryRunner`, `TableColumn`, `TableIndex`
- Produces: Updated database tables with `name_en`, `description_en`, `category_group_en`, `performance_type_en` on `items`; `name_en`, `description_en` on `contexts`; `name_en` on `keywords`; `name_en` on `taxonomy_nodes`.

- [ ] **Step 1: Create the TypeORM migration file**
  Create `frontend/db/migrations/1787400000000-AddBilingualCatalogueColumns.ts`:
  ```typescript
  import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";

  export class AddBilingualCatalogueColumns1787400000000 implements MigrationInterface {
    name = "AddBilingualCatalogueColumns1787400000000";

    async up(queryRunner: QueryRunner): Promise<void> {
      // items
      if (!(await queryRunner.hasColumn("items", "name_en"))) {
        await queryRunner.addColumn(
          "items",
          new TableColumn({ name: "name_en", type: "varchar", length: "255", isNullable: true }),
        );
        await queryRunner.createIndex(
          "items",
          new TableIndex({ name: "ix_items_name_en", columnNames: ["name_en"] }),
        );
      }
      if (!(await queryRunner.hasColumn("items", "description_en"))) {
        await queryRunner.addColumn(
          "items",
          new TableColumn({ name: "description_en", type: "text", isNullable: true }),
        );
      }
      if (!(await queryRunner.hasColumn("items", "category_group_en"))) {
        await queryRunner.addColumn(
          "items",
          new TableColumn({ name: "category_group_en", type: "varchar", length: "255", isNullable: true }),
        );
      }
      if (!(await queryRunner.hasColumn("items", "performance_type_en"))) {
        await queryRunner.addColumn(
          "items",
          new TableColumn({ name: "performance_type_en", type: "varchar", length: "255", isNullable: true }),
        );
      }

      // contexts
      if (!(await queryRunner.hasColumn("contexts", "name_en"))) {
        await queryRunner.addColumn(
          "contexts",
          new TableColumn({ name: "name_en", type: "varchar", length: "255", isNullable: true }),
        );
      }
      if (!(await queryRunner.hasColumn("contexts", "description_en"))) {
        await queryRunner.addColumn(
          "contexts",
          new TableColumn({ name: "description_en", type: "text", isNullable: true }),
        );
      }

      // keywords
      if (!(await queryRunner.hasColumn("keywords", "name_en"))) {
        await queryRunner.addColumn(
          "keywords",
          new TableColumn({ name: "name_en", type: "varchar", length: "255", isNullable: true }),
        );
      }

      // taxonomy_nodes
      if (!(await queryRunner.hasColumn("taxonomy_nodes", "name_en"))) {
        await queryRunner.addColumn(
          "taxonomy_nodes",
          new TableColumn({ name: "name_en", type: "varchar", length: "255", isNullable: true }),
        );
      }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
      if (await queryRunner.hasTable("items")) {
        if (await queryRunner.hasColumn("items", "name_en")) {
          await queryRunner.dropIndex("items", "ix_items_name_en");
          await queryRunner.dropColumn("items", "name_en");
        }
        if (await queryRunner.hasColumn("items", "description_en")) {
          await queryRunner.dropColumn("items", "description_en");
        }
        if (await queryRunner.hasColumn("items", "category_group_en")) {
          await queryRunner.dropColumn("items", "category_group_en");
        }
        if (await queryRunner.hasColumn("items", "performance_type_en")) {
          await queryRunner.dropColumn("items", "performance_type_en");
        }
      }
      if (await queryRunner.hasTable("contexts")) {
        if (await queryRunner.hasColumn("contexts", "description_en")) {
          await queryRunner.dropColumn("contexts", "description_en");
        }
        if (await queryRunner.hasColumn("contexts", "name_en")) {
          await queryRunner.dropColumn("contexts", "name_en");
        }
      }
      if (await queryRunner.hasTable("keywords") && (await queryRunner.hasColumn("keywords", "name_en"))) {
        await queryRunner.dropColumn("keywords", "name_en");
      }
      if (await queryRunner.hasTable("taxonomy_nodes") && (await queryRunner.hasColumn("taxonomy_nodes", "name_en"))) {
        await queryRunner.dropColumn("taxonomy_nodes", "name_en");
      }
    }
  }
  ```

- [ ] **Step 2: Update TypeORM entities in `frontend/db/entities/Catalogue.ts`**
  Add optional English fields to `CatalogueItem`, `CatalogueContext`, `CatalogueKeyword`, and `TaxonomyNode` interfaces and schemas.

- [ ] **Step 3: Run migration**
  Run: `npm --prefix frontend run migration:run`
  Expected: Successful execution of migration `1787400000000-AddBilingualCatalogueColumns`.

- [ ] **Step 4: Commit changes**
  ```bash
  git add frontend/db/migrations/1787400000000-AddBilingualCatalogueColumns.ts frontend/db/entities/Catalogue.ts
  git commit -m "feat(db): add bilingual columns to catalogue tables"
  ```

---

### Task 2: Academic Reference Seed Data (`WIPHITSILPA.pdf` & Initial Seeding)

**Files:**
- Create: `frontend/db/seeds/catalogue-bilingual.seed.ts`
- Modify: `frontend/db/cli.ts:65-75`
- Modify: `frontend/db/bootstrap.ts:1-11`

**Interfaces:**
- Consumes: TypeORM `DataSource`, `paper/ref/WIPHITSILPA.pdf` terminology
- Produces: `seedCatalogueBilingual(dataSource: DataSource): Promise<void>`

- [ ] **Step 1: Prepare bilingual translation dictionary**
  Extract accurate translations from *WIPHITSILPA* (`paper/ref/WIPHITSILPA.pdf`) for:
  - Canonical performances (e.g. "ผืนไท" -> "Phuen Thai", "ฟ้อนดวงเดือน" -> "Fon Duang Duean (Moonlight Dance)", "หนุมานจับนางสุพรรณมัจฉา" -> "Hanuman Captures Suphannamatcha", "ฟ้อนผาง" -> "Fon Phang (Lantern Dance)", etc.)
  - Occasions (`contexts`)
  - Categories & performance types
  - Common cultural keywords (`keywords`)
  - Category hierarchy (`taxonomy_nodes`)

- [ ] **Step 2: Implement `seedCatalogueBilingual` in `frontend/db/seeds/catalogue-bilingual.seed.ts`**
  Update database rows with `UPDATE items SET name_en = ..., description_en = ... WHERE name = ...` (and corresponding contexts/keywords/nodes).

- [ ] **Step 3: Register in `frontend/db/cli.ts` and `frontend/db/bootstrap.ts`**
  Include `seedCatalogueBilingual(dataSource)` in `cli.ts seed` and `bootstrap.ts migrateAndSeed`.

- [ ] **Step 4: Run seed command**
  Run: `npm --prefix frontend run seed`
  Expected: Seed completes without errors.

- [ ] **Step 5: Commit changes**
  ```bash
  git add frontend/db/seeds/catalogue-bilingual.seed.ts frontend/db/cli.ts frontend/db/bootstrap.ts
  git commit -m "feat(seed): add initial bilingual catalogue seeding from WIPHITSILPA reference"
  ```

---

### Task 3: Server Domain Logic & Bilingual Search

**Files:**
- Modify: `frontend/lib/types/catalog.ts:25-70`
- Modify: `frontend/lib/server/catalogue.ts:120-145, 380-505`
- Test: `frontend/tests/catalogue.test.mjs`

**Interfaces:**
- Consumes: Database items with `*_en` columns
- Produces: `ItemOut`, `ContextOut`, `KeywordOut` with English fields; `suitability_label_en`; bilingual search in `listItems()`.

- [ ] **Step 1: Write test for bilingual search and output contract in `frontend/tests/catalogue.test.mjs`**
  Add tests asserting that `getItem` and `listItems` return `name_en`, and searching for English text (e.g. "Phuen Thai") returns matching records.

- [ ] **Step 2: Update `frontend/lib/types/catalog.ts`**
  Add `name_en`, `description_en`, `category_group_en`, `performance_type_en`, `suitability_label_en` to `ItemOut`.
  Add `name_en`, `description_en` to `ContextOut`.
  Add `name_en` to `KeywordOut`.

- [ ] **Step 3: Update `frontend/lib/server/catalogue.ts`**
  - Update `catalogueItemOut` to map `name_en`, `description_en`, `category_group_en`, `performance_type_en`, and `suitability_label_en` (`"Highly Recommended"` / `"Recommended"` / `"Suitable"`).
  - Update `contextOut` and `keywordOut` to map `name_en`.
  - Update `listItems` search loop to search in `nameEn`, `categoryGroupEn`, `descriptionEn` as well as Thai fields.

- [ ] **Step 4: Run tests**
  Run: `npm --prefix frontend run test:catalogue`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add frontend/lib/types/catalog.ts frontend/lib/server/catalogue.ts frontend/tests/catalogue.test.mjs
  git commit -m "feat(api): expose bilingual catalogue fields and support bilingual search"
  ```

---

### Task 4: Frontend Central Localization Helper & Catalogue UI

**Files:**
- Create: `frontend/lib/localization.ts`
- Modify: `frontend/components/CatalogItemCard.tsx`
- Modify: `frontend/app/(public)/items/[id]/page.tsx`
- Modify: `frontend/app/(public)/items/page.tsx`
- Modify: `frontend/app/(public)/categories/page.tsx`
- Modify: `frontend/locales/th.ts` & `frontend/locales/en.ts`

**Interfaces:**
- Consumes: `useTranslation()`, `ItemOut`, `ContextOut`, `KeywordOut`
- Produces: `getLocalizedItem()`, `getLocalizedContext()`, `getLocalizedKeyword()`

- [ ] **Step 1: Create `frontend/lib/localization.ts`**
  Provide helper functions:
  ```typescript
  import type { ContextOut, ItemOut, KeywordOut } from "@/lib/types";

  export function getLocalizedItem(item: ItemOut, locale: "th" | "en") {
    const isEn = locale === "en";
    return {
      ...item,
      displayName: isEn && item.name_en ? item.name_en : item.name,
      displayDescription: isEn && item.description_en ? item.description_en : item.description,
      displayCategoryGroup: isEn && item.category_group_en ? item.category_group_en : item.category_group,
      displayPerformanceType: isEn && item.performance_type_en ? item.performance_type_en : item.performance_type,
      displaySuitability: isEn
        ? (item.suitability_label_en ?? "Recommended")
        : (item.suitability_label ?? "เหมาะสม"),
    };
  }

  export function getLocalizedContext(context: ContextOut, locale: "th" | "en") {
    return {
      ...context,
      displayName: locale === "en" && context.name_en ? context.name_en : context.name,
      displayDescription: locale === "en" && context.description_en ? context.description_en : context.description,
    };
  }

  export function getLocalizedKeyword(keyword: KeywordOut, locale: "th" | "en") {
    return {
      ...keyword,
      displayName: locale === "en" && keyword.name_en ? keyword.name_en : keyword.name,
    };
  }
  ```

- [ ] **Step 2: Update `frontend/components/CatalogItemCard.tsx`**
  Use `useTranslation()`, call `getLocalizedItem(item, locale)`, and display `displayName`, `displayDescription`, `displayCategoryGroup`, `displayPerformanceType`, and localized context pills.

- [ ] **Step 3: Update `frontend/app/(public)/items/[id]/page.tsx`**
  Use `getLocalizedItem(item, locale)`.
  Render localized title, category line, suitability badge (`displaySuitability · ${matchPercent}%`), description, occasion links (`c.name_en || c.name`), keywords (`k.name_en || k.name`), and "About This Performance" sidebar.

- [ ] **Step 4: Update `frontend/app/(public)/categories/page.tsx`**
  Ensure category headers, counts, and occasion pills respect `locale === "en"`.

- [ ] **Step 5: Verify build & type-check**
  Run: `npm --prefix frontend run type-check`
  Expected: 0 errors.

- [ ] **Step 6: Commit changes**
  ```bash
  git add frontend/lib/localization.ts frontend/components/CatalogItemCard.tsx frontend/app/\(public\)/items/ frontend/app/\(public\)/categories/
  git commit -m "feat(ui): apply bilingual item localization across cards and item detail page"
  ```

---

### Task 5: Recommendation Journey Localization (`/recommend` & `/results`)

**Files:**
- Modify: `frontend/components/ContextPicker.tsx`
- Modify: `frontend/components/KeywordPicker.tsx`
- Modify: `frontend/components/MemberShell.tsx`
- Modify: `frontend/app/(public)/recommend/page.tsx`
- Modify: `frontend/app/(public)/results/page.tsx`
- Modify: `frontend/components/RecommendationCard.tsx`
- Modify: `frontend/components/ProfileRecommendationCard.tsx`
- Modify: `frontend/locales/th.ts` & `frontend/locales/en.ts`
- Test: `frontend/tests/recommendations.test.mjs`

**Interfaces:**
- Consumes: Numeric `contextId: number`, `keywordIds: number[]`, `useTranslation()`.
- Produces: 100% localized recommendation form, autocomplete search, taxonomy picker modal, member nav, and result cards, while preserving strict numeric IDs in recommendation requests.

- [ ] **Step 1: Add recommendation dictionary keys to `frontend/locales/th.ts` & `frontend/locales/en.ts`**
  Add namespace `recommend`:
  - `pageTitle`: "กำหนดคำแนะนำของคุณ" / "Configure Your Recommendations"
  - `pageSubtitle`: "ปรับคำแนะนำด้วยโอกาสและคุณลักษณะ" / "Tune Recommendations with Occasions & Attributes"
  - `occasionLabel`: "โอกาสที่ใช้แสดง" / "Performance Occasion"
  - `topKLabel`: "จำนวนผลลัพธ์ (top-K)" / "Number of Results (top-K)"
  - `keywordLabel`: "เลือกคุณลักษณะและคำสำคัญที่สนใจ (ไม่บังคับ)" / "Select Attributes and Keywords of Interest (Optional)"
  - `keywordPlaceholder`: "พิมพ์เพื่อค้นหาคำสำคัญ เช่น ราช โขน พิธี ภาคใต้" / "Type to search keywords, e.g. Royal, Khon, Ceremony, South"
  - `selectFromCategories`: "เลือกจากหมวดหมู่" / "Select from Categories"
  - `selectedAttributes`: "คุณลักษณะที่เลือกแล้ว" / "Selected Attributes"
  - `submitBtn`: "คำนวณคำแนะนำเฉพาะคุณ" / "Calculate Personalized Recommendations"
  - `historyTitle`: "แนะนำจากสิ่งที่คุณชอบ" / "Recommended from Your Preferences"
  - `discoverTitle`: "ค้นหาการแสดงใหม่" / "Discover New Performances"

- [ ] **Step 2: Update `frontend/components/ContextPicker.tsx`**
  Use `useTranslation()`. Render `<option value={c.id}>{locale === "en" && c.name_en ? c.name_en : c.name}</option>`.
  Numeric `value` remains unchanged.

- [ ] **Step 3: Update `frontend/components/KeywordPicker.tsx`**
  Use `useTranslation()`.
  Match keyword queries against both `name` and `name_en`.
  Render chips and suggestions using `locale === "en" && k.name_en ? k.name_en : k.name`.
  Render taxonomy modal nodes using `locale === "en" && node.name_en ? node.name_en : node.name`.
  Numeric `selectedIds` remains unchanged.

- [ ] **Step 4: Update `frontend/app/(public)/recommend/page.tsx` and `MemberShell.tsx`**
  Replace hardcoded Thai strings with `t("recommend.*")` and `t("member.*")`.
  Ensure member navigation tabs (Profile, Favorites, Rating History, Recently Viewed, Recommended, Discover) use translation keys.

- [ ] **Step 5: Update `frontend/app/(public)/results/page.tsx`, `RecommendationCard.tsx`, and `ProfileRecommendationCard.tsx`**
  Use `getLocalizedItem(result.item, locale)`.
  Display `displaySuitability`, localized matched keywords, and result breakdown.

- [ ] **Step 6: Run recommendations regression test**
  Run: `npm --prefix frontend run test:catalogue`
  Expected: PASS

- [ ] **Step 7: Commit changes**
  ```bash
  git add frontend/components/ContextPicker.tsx frontend/components/KeywordPicker.tsx frontend/app/\(public\)/recommend/ frontend/app/\(public\)/results/ frontend/components/RecommendationCard.tsx frontend/components/ProfileRecommendationCard.tsx frontend/locales/
  git commit -m "feat(recommend): localize member recommendation journey while preserving zero algorithmic drift"
  ```

---

### Task 6: Admin Management Bilingual Inputs

**Files:**
- Modify: `frontend/lib/types/admin.ts`
- Modify: `frontend/components/AdminItemFormHelpers.ts`
- Modify: `frontend/components/AdminItemFormDraftStep.tsx`
- Modify: `frontend/app/api/admin/items/draft/route.ts`
- Modify: `frontend/app/api/admin/items/commit/route.ts`

**Interfaces:**
- Consumes: Admin user inputs
- Produces: Persisted `name_en`, `description_en`, `category_group_en`, `performance_type_en` in database draft/commit workflow.

- [ ] **Step 1: Update admin types and draft helpers**
  Add `name_en`, `description_en`, `category_group_en`, `performance_type_en` to `DraftFields` in `frontend/components/AdminItemFormHelpers.ts`.

- [ ] **Step 2: Update `frontend/components/AdminItemFormDraftStep.tsx`**
  Add optional inputs for English performance name, English description, English category, English performance type.

- [ ] **Step 3: Update admin draft & commit API routes**
  Pass English fields into draft storage and commit transaction to `items` table.

- [ ] **Step 4: Run admin tests**
  Run: `npm --prefix frontend run test:admin`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add frontend/lib/types/admin.ts frontend/components/AdminItemForm*.ts* frontend/app/api/admin/items/
  git commit -m "feat(admin): support bilingual draft and commit for performance items"
  ```

---

### Task 7: Comprehensive Verification & Build

**Files:**
- All touched files across tasks 1-6.

- [ ] **Step 1: Verify TypeScript type checks**
  Run: `npm --prefix frontend run type-check`
  Expected: 0 errors.

- [ ] **Step 2: Run all test suites**
  Run:
  - `npm --prefix frontend run test:foundation`
  - `npm --prefix frontend run test:catalogue`
  - `npm --prefix frontend run test:admin`
  Expected: All tests pass.

- [ ] **Step 3: Test production build**
  Run: `npm --prefix frontend run build`
  Expected: Build succeeds cleanly.

- [ ] **Step 4: Final commit & tag if applicable**
  ```bash
  git add .
  git commit -m "chore: complete Phase 2 bilingual catalogue and recommendation support"
  ```
