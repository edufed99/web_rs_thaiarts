/**
 * taxonomy-classifier.ts — Step 2: Hierarchical Taxonomy Classification.
 *
 * Implements the methodology from the paper §3.1.2:
 * 1. Semi-constrained classification into 6 Level-1 Semantic Domains and 19 Level-2 Categories.
 * 2. Zero hierarchy violation guard.
 * 3. Gemini-assisted classification for newly discovered non-stopwords.
 */

export interface TaxonomyPathDefinition {
  level1: string;
  level2: string;
  fullPath: string;
}

export const CANONICAL_TAXONOMY_PATHS: TaxonomyPathDefinition[] = [
  // 1. กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต
  { level1: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต", level2: "วิถีชีวิตและพฤติกรรมทางสังคม", fullPath: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต > วิถีชีวิตและพฤติกรรมทางสังคม" },
  { level1: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต", level2: "วิถีชีวิตและระบบเศรษฐกิจ", fullPath: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต > วิถีชีวิตและระบบเศรษฐกิจ" },
  { level1: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต", level2: "อัตลักษณ์ทางสังคมและกลุ่มคน", fullPath: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต > อัตลักษณ์ทางสังคมและกลุ่มคน" },
  { level1: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต", level2: "โครงสร้างสังคมและบุคคลสำคัญ", fullPath: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต > โครงสร้างสังคมและบุคคลสำคัญ" },

  // 2. บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่
  { level1: "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่", level2: "พื้นที่ทางวัฒนธรรมและสถาบัน", fullPath: "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่ > พื้นที่ทางวัฒนธรรมและสถาบัน" },
  { level1: "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่", level2: "ภูมิศาสตร์และอาณาบริเวณ", fullPath: "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่ > ภูมิศาสตร์และอาณาบริเวณ" },
  { level1: "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่", level2: "ยุคสมัยและเหตุการณ์สำคัญ", fullPath: "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่ > ยุคสมัยและเหตุการณ์สำคัญ" },

  // 3. พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม
  { level1: "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม", level2: "คติความเชื่อและไสยศาสตร์", fullPath: "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม > คติความเชื่อและไสยศาสตร์" },
  { level1: "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม", level2: "จารีตประเพณีและพิธีกรรม", fullPath: "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม > จารีตประเพณีและพิธีกรรม" },
  { level1: "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม", level2: "ระบบความเชื่อและศาสนา", fullPath: "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม > ระบบความเชื่อและศาสนา" },

  // 4. วรรณคดีและสิ่งมีชีวิตเชิงตำนาน
  { level1: "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน", level2: "นามานุกรมและประเภทตัวละคร", fullPath: "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน > นามานุกรมและประเภทตัวละคร" },
  { level1: "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน", level2: "สถานภาพและลำดับชั้นทางสังคมในวรรณกรรม", fullPath: "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน > สถานภาพและลำดับชั้นทางสังคมในวรรณกรรม" },

  // 5. วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง
  { level1: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง", level2: "ประณีตศิลป์และทัศนศิลป์", fullPath: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง > ประณีตศิลป์และทัศนศิลป์" },
  { level1: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง", level2: "พัสตราภรณ์และเครื่องแต่งกาย", fullPath: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง > พัสตราภรณ์และเครื่องแต่งกาย" },
  { level1: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง", level2: "วัสดุและอัญมณี", fullPath: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง > วัสดุและอัญมณี" },
  { level1: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง", level2: "สถาปัตยกรรมและพุทธศิลป์", fullPath: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง > สถาปัตยกรรมและพุทธศิลป์" },

  // 6. ศิลปะการแสดงและดนตรี
  { level1: "ศิลปะการแสดงและดนตรี", level2: "ดุริยางคศิลป์และคีตศิลป์", fullPath: "ศิลปะการแสดงและดนตรี > ดุริยางคศิลป์และคีตศิลป์" },
  { level1: "ศิลปะการแสดงและดนตรี", level2: "นาฏยศิลป์และการแสดง", fullPath: "ศิลปะการแสดงและดนตรี > นาฏยศิลป์และการแสดง" },
  { level1: "ศิลปะการแสดงและดนตรี", level2: "บุคลากรและทักษะทางศิลปะ", fullPath: "ศิลปะการแสดงและดนตรี > บุคลากรและทักษะทางศิลปะ" },
];

const TAXONOMY_CLASSIFICATION_PROMPT = `คุณคือนักอนุกรมวิธาน (Taxonomist) ผู้เชี่ยวชาญด้านศิลปะการแสดงและวัฒนธรรมไทย.

จงจัดหมวดหมู่คำสำคัญ (Taxonomy Classification) ให้กับคำศัพท์ที่กำหนด โดยต้องเลือกจาก "โครงสร้างหมวดหมู่ที่กำหนดไว้ 19 หมวด" ด้านล่างนี้เท่านั้น (ห้ามสร้างชื่อหมวดหมู่ใหม่ขึ้นมาเอง):

[โครงสร้าง Taxonomy ที่ได้รับอนุญาต (19 หมวด)]
{taxonomy_paths}

[คำศัพท์ที่ต้องจัดหมวดหมู่]
{words_to_classify}

จงตอบกลับเป็น JSON array ในรูปแบบนี้เท่านั้น:
{
  "classifications": [
    {
      "word": "คำศัพท์",
      "level1": "ชื่อหมวด Level 1 ที่ตรงกันเป๊ะ",
      "level2": "ชื่อหมวด Level 2 ที่ตรงกันเป๊ะ",
      "confidence": 0.95
    }
  ]
}
`;

export async function classifyNewKeywordsWithGemini(
  words: string[],
): Promise<Map<string, { level1: string; level2: string; fullPath: string; confidence: number }>> {
  const result = new Map<string, { level1: string; level2: string; fullPath: string; confidence: number }>();
  if (words.length === 0) return result;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    // Default fallback to "ศิลปะการแสดงและดนตรี > นาฏยศิลป์และการแสดง"
    for (const word of words) {
      result.set(word, {
        level1: "ศิลปะการแสดงและดนตรี",
        level2: "นาฏยศิลป์และการแสดง",
        fullPath: "ศิลปะการแสดงและดนตรี > นาฏยศิลป์และการแสดง",
        confidence: 0.5,
      });
    }
    return result;
  }

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const pathList = CANONICAL_TAXONOMY_PATHS.map((p) => `- [${p.level1}] -> ${p.level2}`).join("\n");
  const wordsList = words.map((w) => `- ${w}`).join("\n");

  const prompt = TAXONOMY_CLASSIFICATION_PROMPT
    .replace("{taxonomy_paths}", pathList)
    .replace("{words_to_classify}", wordsList);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[taxonomy-classifier] Gemini classification returned status ${response.status}`);
      return fallbackAll(words);
    }

    const data = await response.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) return fallbackAll(words);

    const parsed = JSON.parse(rawJson);
    const classifications = Array.isArray(parsed?.classifications) ? parsed.classifications : [];

    for (const c of classifications) {
      if (!c?.word) continue;
      const matchedPath = CANONICAL_TAXONOMY_PATHS.find(
        (p) => p.level1 === c.level1 && p.level2 === c.level2,
      ) || CANONICAL_TAXONOMY_PATHS.find(
        (p) => p.level2 === c.level2,
      ) || CANONICAL_TAXONOMY_PATHS[17]; // default to "นาฏยศิลป์และการแสดง"

      result.set(String(c.word).trim(), {
        level1: matchedPath.level1,
        level2: matchedPath.level2,
        fullPath: matchedPath.fullPath,
        confidence: typeof c.confidence === "number" ? c.confidence : 0.85,
      });
    }

    // Any words missing from classification get fallback
    for (const word of words) {
      if (!result.has(word)) {
        result.set(word, {
          level1: "ศิลปะการแสดงและดนตรี",
          level2: "นาฏยศิลป์และการแสดง",
          fullPath: "ศิลปะการแสดงและดนตรี > นาฏยศิลป์และการแสดง",
          confidence: 0.5,
        });
      }
    }

    return result;
  } catch (error) {
    console.warn("[taxonomy-classifier] Taxonomy classification failed, graceful fallback:", error);
    return fallbackAll(words);
  }
}

function fallbackAll(words: string[]): Map<string, { level1: string; level2: string; fullPath: string; confidence: number }> {
  const map = new Map<string, { level1: string; level2: string; fullPath: string; confidence: number }>();
  for (const w of words) {
    map.set(w, {
      level1: "ศิลปะการแสดงและดนตรี",
      level2: "นาฏยศิลป์และการแสดง",
      fullPath: "ศิลปะการแสดงและดนตรี > นาฏยศิลป์และการแสดง",
      confidence: 0.5,
    });
  }
  return map;
}
