/**
 * semantic-pipeline.ts — Step 1: Semantic Stopword Filtering & Lexical Engine.
 *
 * Implements the methodology from the paper §3.1.1 and old code/3.keyword mapping to item:
 * 1. Domain-specific custom dictionary (CUSTOM_WORDS) for Thai performing arts.
 * 2. Text normalization and diacritic stripping (NFKC, lowercase, diacritic regex [่-์​-‏]).
 * 3. Predefined generic low-value terms filter.
 * 4. Gemini-assisted semantic stopword filtering under controlled prompt protocol.
 */

export const CUSTOM_WORDS = [
  "เพลงงามแสงเดือน", "เพลงชาวไทย", "เพลงรำซิมารำ", "เพลงคืนเดือนหงาย",
  "เพลงดวงจันทร์วันเพ็ญ", "เพลงดอกไม้ของชาติ", "เพลงดวงจันทร์ขวัญฟ้า", "เพลงหญิงไทยใจงาม",
  "เพลงบูชานักรบ", "เพลงยอดชายใจหาญ", "มรดกภูมิปัญญาทางวัฒนธรรม", "เครื่องดนตรีพื้นเมือง",
  "เครื่องดนตรีตะวันตก", "ตารีบุหงา", "พื้นบ้านภาคใต้", "การร่อนแร่",
  "ท่านผู้หญิงแผ้ว สนิทวงศ์เสนี", "ผู้เชี่ยวชาญ", "นายประพันธ์ สุคนธะชาติ",
  "เพลงลาวคำหอม", "เพลงอัตราจังหวะสองชั้น", "เพลงสำเนียงลาว",
  "พระเจ้าบรมวงศ์เธอกรมหมื่นพิชัยมหินทโรดม", "ดนตรีพื้นบ้าน", "ชัดเจน",
  "ผางประทีป", "เจ้าดารารัศมี", "น้อยใจยา", "พญาผานอง", "อาจารย์มนตรี ตราโมท",
  "เพลงฟ้อนดวงดอกไม้", "นางพญาคำปิน", "เพลงซุ้ม", "พระลอ",
  "พระเจ้าบรมวงศ์เธอกรมพระนราธิปประพันธ์พงศ์", "ลิลิตพระลอ", "แมนสรวง",
  "พิชัยพิษณุกร", "สรอง", "สะล้อ", "เต้นสาก", "การละเล่นพื้นเมือง", "กระทบไม้",
  "ภูไท", "ลำตังหวาย", "ไทภูเขา", "เทือกเขาภูพาน", "การเดินทาง", "ผีภู",
  "ภารกิจ", "เชื้อสาย", "สืบต่อ", "มวยโบราณ", "กระบวนท่าทาง", "กระบวนท่ารำ",
  "การรบ", "การขึ้นลอย", "ขีดขิน", "กรุงลงกา", "พระเมรุ", "ชามพูวราช",
  "เขาไกลลาศ", "นิ้วเพชร", "เห็นว่า", "พญาขร", "มังกรกัณฐ์", "แว่นแก้วสุรกานต์",
  "พระพาย", "มัยราพณ์", "หอกโมกขศักดิ์", "พระลาน", "สำมนักขา", "บอกว่า",
  "ปรศุราม", "พระศิวะ", "ปารวตี", "พระคเณศ", "งาช้าง", "มารีศ", "พระยา",
  "กากนาสูร", "สมมุติเทพ", "สารัณ", "กาลสูร", "ศรพรหมาสตร์", "รุทการ",
  "การุณราช", "ช้างเอราวัณ", "พญาทูษณ์", "ท้าวลัสเตียน", "รัชฎา", "วิรุญจำบัง",
  "นิลพาหุ", "สัทธาสูร", "วิรุญมุข", "ศรนาคบาศ", "เขาอังกาศ", "พระลักษมณ์",
  "พระยาทูษณ์", "ศรพาลจันทร์", "เขาสัตภัณฑ์", "ดินดาล", "ต้นรัง", "สังข์ทอง",
  "พระสังข์", "เจ้าเงาะ", "บุปเพสันนิวาส", "เกียรติศักดิ์ไทย", "เขาไกรลาส",
  "รัวฉิ่ง", "พระบรมราชชนนีพับปีหลวง", "ไทยเรือนต้น", "ไทยจิตรลดา", "ไทยอมรินทร์",
  "ไทยบรมพิมาน", "ไทยจักรี", "ไทยดุสิต", "ไทยจักรพรรดิ์", "ไทยศิวาลัย",
  "ทิพยวิมาน", "องค์ปะตาระกาหลา", "ศุภลักษณ์", "ย่องหงิด", "นางอัปสราบายน",
  "ปราสาทเมืองสิงห์", "แควน้อย", "ปราสาทพระขรรค์", "พระเจ้าชัยวรมัน",
  "พระบาทสมเด็จพระจอมเกล้าเจ้าอยู่หัว", "แต่งกายยืนเครื่องพระ",
  "แต่งกายยืนเครื่องพระ-นาง", "เพลงกลม", "เพลงชำนาญ", "รังควาญ",
  "เพลงฝรั่งรำเท้า", "ตะเขิ่ง", "เจ้าเซ็น", "เพลงเร็ว", "เพลงฉิ่ง", "จีนรัว",
  "จีนรำพัด", "จีนถอน", "พลายชุมพล", "รำเดี่ยว", "ขุนช้าง", "ขุนแผน",
  "พระไวย", "เพลงมอญดูดาว", "สุพรรณมัจฉา", "ภาพจำหลัก", "ปราสาทหินพิมาย",
  "ปราสาทพนมรุ้ง", "แหลมมลายู", "หล่อสำริด", "ปางลีลา", "สมัยสุโขทัย",
  "พระอุมา", "ยอพระกลิ่น", "มณีพิชัย", "วันทอง", "ศูรปนขา", "พัดเรนัง", "บุหรงซีงอ",
  "ลาวครั่ง", "ไทยทรงดำ", "ลาวเวียง", "ไทยรามัญ", "ไทยจีน", "อันหนึ่งอันเดียว", "ร่มพระบารมี",
  "พระแม่คงคา", "มรดกวัฒนธรรม", "ธงไทย", "ขันดอก", "บูชาครู", "พระนิพนธ์", "พระพี่เลี้ยง",
  "พระเพื่อน", "พระแพง", "ท้าวพิชัยพิษณุกร", "เครื่องประกอบจังหวะ", "ขับลำ", "การงาน", "ชาวภูไท",
  "ไส้กะลา", "ตรีชฎา", "พระราชบัญชา", "หลักราชการ", "จำกาย", "ท้าวสัทธาสูร", "รูปนอก",
  "รำคู่", "ผู้แสดง", "สมัยทวารวดี", "สมัยลพบุรี", "สมัยศรีวิชัย", "นนทก", "พระสวามี",
  "ต้นลีลาวดี", "ระบำโบราณคดี", "ผู้มีพระคุณ", "การประกอบอาชีพ", "การแต่งกาย", "ตารีกีปัส",
  "นายแก้ว", "นายขวัญ", "นางรื่น", "นางโรย์", "กรรมวิธี", "การเก็บใบชา", "สากตำข้าว", "การแสดงพื้นเมือง",
  "การดีด", "แม่น้ำโขง", "จัดทัพ", "ตรวจพล", "พลวานร", "เมืองขีดขิน", "เมืองชมพู", "ทหารเอก",
  "ประเทศไทย", "ระบำมาตรฐาน", "สระอโนดาต", "นางเบญจกาย", "นางสีดา", "เขาไกรลาศ",
  "รูปทอง", "เล่นน้ำ", "วิรุณจำบัง", "พลลิง", "ข่ายเหล็ก", "ข่ายเพชร", "นางกินรี",
  "ดอกไม้เงิน", "ดอกไม้ทอง", "รำมาตรฐาน", "สีทอง", "สี่ภาค", "ทรงเครื่อง",
  "จับนาง", "ไล่จับ", "ไล่ติดตาม", "ศิลปะป้องกันตัว",
  "การนุ่งห่ม", "รำซัด", "ต้อนรับแขก", "แร้ง",
];

export const GENERIC_TERMS_PREDEFINED = new Set([
  "การแสดง",
  "พื้นบ้าน",
  "นาฏศิลป์",
  "วัฒนธรรม",
  "ศิลปะ",
  "การ",
]);

export function normalizeThaiText(text: string): string {
  if (!text) return "";
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("th")
    // Strip Thai diacritics (่-์) and zero-width chars, matching [่-์​-‏]
    .replace(/[่-์​-‏]/g, "")
    .trim();
}

/**
 * Extract tokens using Domain-Aware Longest Matching Scanner.
 */
export function domainAwareTokenize(text: string, vocabulary: string[]): Set<string> {
  const normText = normalizeThaiText(text);
  if (!normText) return new Set();

  const tokens = new Set<string>();
  // Split on whitespace as baseline
  const spaceTokens = normText.split(/\s+/).filter(Boolean);
  for (const st of spaceTokens) {
    tokens.add(st);
  }

  // Scan for domain custom words and vocabulary words
  const allDomainWords = [...vocabulary, ...CUSTOM_WORDS];
  for (const word of allDomainWords) {
    const normWord = normalizeThaiText(word);
    if (normWord && normWord.length >= 2 && normText.includes(normWord)) {
      tokens.add(normWord);
    }
  }

  return tokens;
}

/**
 * Step 1: Prompt protocol for Semantic Stopword Filtering using Gemini.
 * Evaluates candidates against 4 paper criteria:
 * 1. Umbrella / generic terms
 * 2. Abstract / evaluative terms
 * 3. Domain overuse terms
 * 4. Redundant / synonym terms
 */
const STOPWORD_FILTER_PROMPT = `คุณคือผู้เชี่ยวชาญด้านภาษาศาสตร์และนาฏศิลป์ไทย (Expert Curator in Thai Performing Arts).

จงทำหน้าที่คัดกรองคำสำคัญ (Semantic Stopword Filtering) จากรายชื่อคำศัพท์ที่สกัดได้จากข้อมูลชุดการแสดงต่อไปนี้:

[ข้อมูลชุดการแสดง]
ชื่อ: {name}
หมวดหมู่: {category}
ประเภทการแสดง: {ptype}
คำอธิบาย: {description}

[เกณฑ์การคัดกรองคำตามระเบียบวิธีวิจัย]
1. กรองคำที่เป็น Stopword ออก ได้แก่:
   - คำครอบจักรวาล/ทั่วไปเกินไป (Umbrella/Generic terms เช่น การแสดง, วัฒนธรรม, ศิลปะ, สวยงาม, ประทับใจ, ดีเลิศ)
   - คำนามธรรมหรือคำประเมินค่า (Abstract/Evaluative terms)
   - คำเชื่อม คำบุพบท หรือคำกริยาทั่วไปที่ไม่มีคุณค่าเชิงความหมายเฉพาะทางนาฏศิลป์
2. เก็บรักษาเฉพาะคำที่ไม่ใช่ Stopword (Non-stopwords) ได้แก่:
   - ศัพท์เฉพาะทางนาฏศิลป์ไทย, ชื่อเพลง, ทำนอง, ท่ารำ, เครื่องแต่งกาย, เครื่องประดับ, วรรณคดี, ตัวละคร, เครื่องดนตรี, วิถีชีวิต, พิธีกรรม, ยุคสมัย, ชาติพันธุ์

[รายชื่อคำศัพท์ที่ต้องคัดกรอง]
{candidate_words}

จงส่งผลลัพธ์เฉพาะคำที่ "ผ่านการคัดกรองว่าเป็น Non-stopwords" ในรูปแบบ JSON array อย่างเคร่งครัด:
{"non_stopwords": ["คำที่ 1", "คำที่ 2", ...]}
`;

export async function filterStopwordsWithGemini(
  candidates: string[],
  item: { name: string; description?: string; category_group?: string; performance_type?: string },
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || candidates.length === 0) {
    return candidates;
  }

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const prompt = STOPWORD_FILTER_PROMPT
    .replace("{name}", item.name || "")
    .replace("{category}", item.category_group || "")
    .replace("{ptype}", item.performance_type || "")
    .replace("{description}", item.description || "")
    .replace("{candidate_words}", candidates.map((c) => `- ${c}`).join("\n"));

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
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      console.warn(`[semantic-pipeline] Gemini stopword filter returned status ${response.status}`);
      return candidates;
    }

    const data = await response.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) return candidates;

    const parsed = JSON.parse(rawJson);
    const nonStopwords: string[] = Array.isArray(parsed?.non_stopwords) ? parsed.non_stopwords : [];
    return nonStopwords.filter((w) => typeof w === "string" && w.trim().length > 0);
  } catch (error) {
    console.warn("[semantic-pipeline] Stopword filter failed, graceful fallback:", error);
    return candidates;
  }
}
