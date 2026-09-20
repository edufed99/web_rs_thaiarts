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
