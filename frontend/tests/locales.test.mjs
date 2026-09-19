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

  const thMod = loadTs("th.ts");
  const enMod = loadTs("en.ts");
  const indexMod = loadTs("index.ts");
  th = thMod.th;
  en = enMod.en;
  getDictionary = indexMod.getDictionary;
  translate = indexMod.translate;
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
