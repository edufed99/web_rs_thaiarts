import { en } from "./en";
import { th, type TranslationDictionary } from "./th";

export type Locale = "th" | "en";
export const LOCALE_COOKIE_KEY = "NEXT_LOCALE";
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
