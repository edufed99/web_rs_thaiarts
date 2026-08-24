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
  "ชุดการแสดง",
  "การแสดงชุด",
  "การแสดงสร้างสรรค์",
  "การแสดงนาฏศิลป์สร้างสรรค์",
  "ประเทศไทย",
  "ประเทศ",
  "รูปแบบ",
  "ลักษณะ",
]);

export function cleanKeywordString(word: string): string {
  if (!word) return "";
  return word
    .replace(/^["'“‘]+|["'”’]+$/g, "") // strip quotes
    .replace(/^[,\-–—.;:()\[\]{}]+|[,\-–—.;:()\[\]{}]+$/g, "") // strip punctuation
    .trim();
}

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
 * Step 1: Gemini-assisted Domain Non-stopword Keyword Extraction & Filtering.
 * Evaluates the full item description and extracts ONLY atomic, high-value domain keywords
 * according to the 4 Paper Criteria (§3.1.1).
 */
const EXTRACT_NON_STOPWORDS_PROMPT = `คุณคือผู้เชี่ยวชาญด้านภาษาศาสตร์เชิงคำนวณและนาฏศิลป์ไทย (Computational Linguist in Thai Performing Arts).

จงทำหน้าที่ 2 ขั้นตอน:
1. วิเคราะห์ข้อมูลชุดการแสดงด้านล่าง และสกัด "คำสำคัญเฉพาะทางที่เป็น Non-stopwords (Atomic Domain Keywords)"
2. กรองและตัดคำหยุด (Stopwords) ออกตามเกณฑ์ Paper §3.1.1 อย่างเคร่งครัด:
   - ห้ามนำประโยคหรือวลียาวๆ มาเป็นคำสำคัญ (เช่น 'มีวัฒนธรรมประเพณีที่งดงาม', 'สะท้อนวิถีชีวิตไทย')
   - กรองคำที่มีความหมายกว้าง/ครอบจักรวาลออก (Umbrella Terms: เช่น ประเทศไทย, รูปแบบ, ชุดการแสดง, ลักษณะ, กิจกรรม)
   - กรองคำเชิงนามธรรมหรือคำประเมินค่าออก (Abstract/Evaluative Terms: เช่น งดงาม, สวยงาม, ประทับใจ, ความสุข, โดดเด่น)
   - กรองคำเฉพาะโดเมนที่พบบ่อยจนไม่ช่วยจำแนกออก (Domain-Specific Overuse: เช่น การแสดง, ศิลปะ, วัฒนธรรม, นาฏศิลป์, การแสดงสร้างสรรค์, การแสดงชุด)
   - กรองคำซ้ำซ้อน
3. สกัดเฉพาะ "คำสำคัญเดี่ยว (Atomic Keywords / Specific Noun Phrases ความยาวกระชับ 1-3 คำ)" ที่ระบุอัตลักษณ์เฉพาะทาง เช่น:
   - ชื่อชุดการแสดงเฉพาะ, เครื่องแต่งกาย, เครื่องประดับ, เครื่องดนตรี, ท่ารำ, ทำนองเพลง, ตัวละคร, วรรณคดี, พิธีกรรม, วิถีชีวิตเฉพาะ, ชาติพันธุ์, ภูมิศาสตร์เฉพาะ

[ข้อมูลชุดการแสดง]
ชื่อการแสดง: {name}
ประเภทการแสดง: {ptype}
หมวดหมู่: {category}
คำอธิบาย: {description}

จงตอบเป็น JSON array ของคำสำคัญที่กระชับและผ่านเกณฑ์เท่านั้น (ตัดเครื่องหมายคำพูด/อัญประกาศออก):
{"keywords": ["คำสำคัญ 1", "คำสำคัญ 2"]}
`;

export async function extractNonStopwordsWithGemini(
  item: { name: string; description?: string; category_group?: string; performance_type?: string },
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return [];

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  const prompt = EXTRACT_NON_STOPWORDS_PROMPT
    .replace("{name}", item.name || "")
    .replace("{category}", item.category_group || "")
    .replace("{ptype}", item.performance_type || "")
    .replace("{description}", item.description || "");

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
      console.warn(`[semantic-pipeline] Gemini extraction returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) return [];

    const parsed = JSON.parse(rawJson);
    const rawKeywords: string[] = Array.isArray(parsed?.keywords) ? parsed.keywords : [];

    const cleanKeywords: string[] = [];
    for (const kw of rawKeywords) {
      if (typeof kw !== "string") continue;
      const clean = cleanKeywordString(kw);
      // Filter out long phrases (> 35 chars) or empty or known generic terms
      if (clean.length >= 2 && clean.length <= 35 && !GENERIC_TERMS_PREDEFINED.has(clean)) {
        cleanKeywords.push(clean);
      }
    }
    return cleanKeywords;
  } catch (error) {
    console.warn("[semantic-pipeline] Non-stopword extraction failed:", error);
    return [];
  }
}
