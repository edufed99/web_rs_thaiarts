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

export const CONTEXT_TRANSLATION_MAP: Record<string, string> = {
  "วันสงกรานต์": "Songkran Festival (Thai Water Festival)",
  "วันขึ้นปีใหม่": "New Year's Day Celebration",
  "การเผยแพร่วัฒนธรรมในประเทศ": "Domestic Cultural Exhibition & Festival",
  "การเผยแพร่วัฒนธรรมต่างประเทศ": "International Cultural Exchange & Diplomacy",
  "งานต้อนรับอาคันตุกะ": "Reception of State Guests & Dignitaries",
  "งานทำบุญ": "Buddhist Merit-Making Ceremony",
  "งานวันเกิด": "Birthday Celebration & Longevity Milestone",
  "งานเปิดบริษัท": "Grand Opening & Corporate Ceremony",
  "วันลอยกระทง": "Loy Krathong Festival (Festival of Lights)",
  "งานแต่งงาน": "Wedding Ceremony & Celebration",
  "งานขึ้นบ้านใหม่": "Housewarming Ceremony",
  "วันตรุษจีน": "Chinese New Year Celebration",
  "งานบวงสรวง": "Votive Worship & Sacred Dedication Ceremony",
  "งานสวดมนต์ข้ามปี": "New Year Eve Chanting & Spiritual Vigil",
  "งานเทศมหาชาติ": "The Great Birth Sermon (Vessantara Jataka Recitation)",
  "งานสโมสรสันนิบาต": "State Reception & Diplomatic Gala",
  "งานไหว้ครู": "Wai Khru (Teachers & Masters Homage Ceremony)",
  "วันวิสาขบูชา": "Visakha Bucha Day (Buddha Day)",
  "วันเข้าพรรษา": "Khao Phansa (Buddhist Lent Commencement)",
  "วันออกพรรษา": "Ok Phansa (End of Buddhist Lent)",
  "งานประชุมสงฆ์": "Sangha Assembly & Ecclesiastical Gathering",
  "งานสวดอภิธรรม": "Abhidhamma Funeral Wake & Chanting",
  "งานฌาปนกิจศพ": "Cremation & Memorial Ceremony",
  "งานเฉลิมพระชนมพรรษาพระบรมวงศานุวงศ์": "Royal Birthday & National Jubilee Celebration",
  "งานพระราชทานเพลิงศพ": "Royal Cremation & State Funeral Rite",
};

export function getLocalizedContext(context: ContextOut, locale: "th" | "en") {
  const isEn = locale === "en";
  const nameEn = context.name_en || (isEn ? CONTEXT_TRANSLATION_MAP[context.name] : null);
  return {
    ...context,
    displayName: isEn && nameEn ? nameEn : context.name,
    displayDescription: isEn && context.description_en ? context.description_en : context.description,
  };
}

export function getLocalizedKeyword(keyword: KeywordOut, locale: "th" | "en") {
  return {
    ...keyword,
    displayName: locale === "en" && keyword.name_en ? keyword.name_en : keyword.name,
  };
}

export function translateExplanationToEn(
  explanation: string,
  contextNameEn?: string,
  item?: ItemOut,
): string {
  if (!explanation) return "";
  if (
    !explanation.startsWith("แนะนำเพราะ") &&
    !explanation.startsWith("ขณะนี้ระบบ") &&
    !explanation.startsWith("แนะนำจาก")
  ) {
    return explanation;
  }
  if (explanation.includes("ระบบโมเดลไม่พร้อมใช้งาน")) {
    return "Model service is currently unavailable; showing popular performances for this occasion as a temporary fallback.";
  }
  const match = explanation.match(
    /แนะนำเพราะตรงกับ\s*“([^”]+)”(?:\s*และคำสำคัญ\s*([^.]+?))?(?:\s*และ\s*(.+?))?\./,
  );
  if (match) {
    const rawCtx = match[1];
    const rawKws = match[2];
    const rawHist = match[3];

    const ctx = contextNameEn || CONTEXT_TRANSLATION_MAP[rawCtx] || rawCtx;
    let parts = `it matches “${ctx}”`;
    if (rawKws) {
      let enKws = rawKws;
      if (item?.keywords) {
        for (const kw of item.keywords) {
          if (kw.name_en && enKws.includes(kw.name)) {
            enKws = enKws.split(kw.name).join(kw.name_en);
          }
        }
      }
      enKws = enKws.replace(/“/g, "“").replace(/”/g, "”").replace(/\s+และ\s+/g, " and ");
      const kwLabel = enKws.includes(" and ") ? "keywords" : "keyword";
      parts += ` and ${kwLabel} ${enKws}`;
    }
    if (rawHist) {
      let enHist = rawHist;
      if (rawHist.includes("เคยกดถูกใจ") || rawHist.includes("เคยถูกใจ")) {
        enHist = "you previously liked similar performances";
        if (rawHist.includes("สร้างสรรค์")) enHist = "you previously liked creative dance performances";
        if (rawHist.includes("อนุรักษ์")) enHist = "you previously liked classical conservative dance performances";
      } else if (rawHist.includes("เคยบันทึก")) {
        enHist = "you previously saved similar performances";
      } else if (rawHist.includes("เคยให้คะแนนสูง")) {
        enHist = "you previously gave high ratings to similar performances";
      }
      parts += `, and ${enHist}`;
    }
    return `Recommended because ${parts}.`;
  }
  if (explanation.includes("ตรงกับคำสำคัญ")) {
    return "Recommended because it matches selected keywords.";
  }
  if (explanation.includes("ใกล้เคียงคำสำคัญ")) {
    return "Recommended because it is close to selected keywords.";
  }
  if (explanation.includes("เหมาะกับเงื่อนไข")) {
    return "Recommended because it suits the selected criteria.";
  }
  if (explanation.includes("เคยชอบ") || explanation.includes("เคยถูกใจ")) {
    return "Recommended based on your preferences and previous engagement.";
  }
  return "Recommended for this occasion and your preference signals.";
}
