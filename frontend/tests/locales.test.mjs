import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

let th;
let en;
let getDictionary;
let translate;

try {
  ({ en } = await import("../locales/en.js"));
  ({ getDictionary, translate } = await import("../locales/index.js"));
  ({ th } = await import("../locales/th.js"));
} catch {
  // If native ESM loader doesn't resolve .ts files (vanilla Node without tsx),
  // transpile .ts files on-the-fly using the repository's TypeScript compiler.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const frontendDir = resolve(__dirname, "..");
  const require = createRequire(import.meta.url);
  const ts = require(resolve(frontendDir, "node_modules/typescript"));

  const cache = new Map();
  function loadTs(relPath) {
    if (cache.has(relPath)) return cache.get(relPath);
    const fullPath = resolve(frontendDir, "locales", relPath);
    const code = readFileSync(fullPath, "utf8");
    const transpiled = ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const m = { exports: {} };
    cache.set(relPath, m.exports);
    const fn = vm.runInThisContext(
      `(function(module, exports, require) { ${transpiled.outputText}\n})`,
    );
    fn(m, m.exports, (dep) => {
      if (dep.includes("th")) return loadTs("th.ts");
      if (dep.includes("en")) return loadTs("en.ts");
      return {};
    });
    return m.exports;
  }

  function loadTsFile(fullPath) {
    if (cache.has(fullPath)) return cache.get(fullPath);
    const code = readFileSync(fullPath, "utf8");
    const transpiled = ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const m = { exports: {} };
    cache.set(fullPath, m.exports);
    const fn = vm.runInThisContext(
      `(function(module, exports, require) { ${transpiled.outputText}\n})`,
    );
    fn(m, m.exports, (dep) => {
      if (dep.includes("th")) return loadTs("th.ts");
      if (dep.includes("en")) return loadTs("en.ts");
      return {};
    });
    return m.exports;
  }

  const thMod = loadTs("th.ts");
  const enMod = loadTs("en.ts");
  const indexMod = loadTs("index.ts");
  th = thMod.th;
  en = enMod.en;
  getDictionary = indexMod.getDictionary;
  translate = indexMod.translate;

  const locMod = loadTsFile(resolve(frontendDir, "lib", "localization.ts"));
  var { getLocalizedItem, getLocalizedContext, getLocalizedKeyword, translateExplanationToEn } = locMod;
}

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

test("getLocalizedItem returns localized fields in English and falls back to Thai", () => {
  const item = {
    id: 1,
    name: "ผืนไท",
    name_en: "Phuen Thai",
    description: "คำอธิบายไทย",
    description_en: "English Description",
    category_group: "การแสดงสร้างสรรค์",
    category_group_en: "Creative Dance",
    performance_type: "ระบำ",
    performance_type_en: "Dance",
    suitability_label: "เหมาะสม",
    suitability_label_en: "Recommended",
  };

  const enItem = getLocalizedItem(item, "en");
  assert.strictEqual(enItem.displayName, "Phuen Thai");
  assert.strictEqual(enItem.displayDescription, "English Description");
  assert.strictEqual(enItem.displayCategoryGroup, "Creative Dance");
  assert.strictEqual(enItem.displayPerformanceType, "Dance");
  assert.strictEqual(enItem.displaySuitability, "Recommended");

  const thItem = getLocalizedItem(item, "th");
  assert.strictEqual(thItem.displayName, "ผืนไท");
  assert.strictEqual(thItem.displayDescription, "คำอธิบายไทย");
  assert.strictEqual(thItem.displayCategoryGroup, "การแสดงสร้างสรรค์");
  assert.strictEqual(thItem.displayPerformanceType, "ระบำ");
  assert.strictEqual(thItem.displaySuitability, "เหมาะสม");

  const partialItem = {
    id: 2,
    name: "โขน",
    name_en: null,
    description: "โขนไทย",
    description_en: null,
    category_group: "โขน",
    category_group_en: null,
    performance_type: "โขน",
    performance_type_en: null,
    suitability_label: null,
    suitability_label_en: null,
  };
  const fallbackItem = getLocalizedItem(partialItem, "en");
  assert.strictEqual(fallbackItem.displayName, "โขน");
  assert.strictEqual(fallbackItem.displayDescription, "โขนไทย");
  assert.strictEqual(fallbackItem.displayCategoryGroup, "โขน");
  assert.strictEqual(fallbackItem.displayPerformanceType, "โขน");
  assert.strictEqual(fallbackItem.displaySuitability, "Recommended");
});

test("getLocalizedContext and getLocalizedKeyword return localized fields", () => {
  const context = {
    id: 10,
    name: "งานมงคล",
    name_en: "Auspicious Event",
    group: "มงคล",
    description: "รายละเอียด",
    description_en: "Details in English",
    active_item_count: 5,
  };
  const enCtx = getLocalizedContext(context, "en");
  assert.strictEqual(enCtx.displayName, "Auspicious Event");
  assert.strictEqual(enCtx.displayDescription, "Details in English");

  const thCtx = getLocalizedContext(context, "th");
  assert.strictEqual(thCtx.displayName, "งานมงคล");
  assert.strictEqual(thCtx.displayDescription, "รายละเอียด");

  const keyword = {
    id: 20,
    name: "ชฎา",
    name_en: "Chada (Crown)",
    taxonomy_path: "ศีรษะ",
  };
  const enKw = getLocalizedKeyword(keyword, "en");
  assert.strictEqual(enKw.displayName, "Chada (Crown)");
  const thKw = getLocalizedKeyword(keyword, "th");
  assert.strictEqual(thKw.displayName, "ชฎา");
});

test("getLocalizedContext falls back to CONTEXT_TRANSLATION_MAP when name_en is missing in English mode", () => {
  const context = {
    id: 11,
    name: "งานขึ้นบ้านใหม่",
    name_en: null,
    group: "มงคล",
    description: "",
    active_item_count: 5,
  };
  const enCtx = getLocalizedContext(context, "en");
  assert.strictEqual(enCtx.displayName, "Housewarming Ceremony");
});

test("translateExplanationToEn translates recommendation explanations accurately", () => {
  const raw1 = "แนะนำเพราะตรงกับ “งานขึ้นบ้านใหม่” และคำสำคัญ “สงคราม”.";
  const en1 = translateExplanationToEn(raw1, "Housewarming Ceremony");
  assert.strictEqual(en1, 'Recommended because it matches “Housewarming Ceremony” and keyword “สงคราม”.');

  const raw2 = "แนะนำเพราะตรงกับ “งานขึ้นบ้านใหม่” และคำสำคัญ “ผู้แสดงฝ่ายชาย” และคุณเคยกดถูกใจการแสดงกลุ่มนาฏศิลป์อนุรักษ์.";
  const en2 = translateExplanationToEn(raw2, "Housewarming Ceremony");
  assert.ok(en2.includes("Recommended because it matches “Housewarming Ceremony”"));
  assert.ok(en2.includes("you previously liked classical conservative dance performances"));

  const fallbackThai = "ขณะนี้ระบบโมเดลไม่พร้อมใช้งาน จึงแสดงรายการในบริบทนี้เรียงตามความนิยมชั่วคราว";
  const enFallback = translateExplanationToEn(fallbackThai);
  assert.ok(enFallback.includes("Model service is currently unavailable"));
});
