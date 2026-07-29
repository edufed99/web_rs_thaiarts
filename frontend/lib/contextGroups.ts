import type { ContextOut } from "./types";

export interface ContextGroup {
  label: string;
  contexts: ContextOut[];
}

const GROUP_ORDER = [
  "งานเทศกาล",
  "งานเผยแพร่วัฒนธรรม",
  "งานมงคล",
  "งานศาสนาและพระราชพิธี",
  "งานอวมงคล",
  "โอกาสอื่น ๆ",
];

function inferGroupName(context: ContextOut): string {
  const name = context.name.trim();
  const explicit = context.group.trim();
  if (explicit.length > 0) return explicit;

  if (name.startsWith("วัน")) return "งานเทศกาล";
  if (name.startsWith("การเผยแพร่")) return "งานเผยแพร่วัฒนธรรม";
  if (
    [
      "งานฌาปนกิจศพ",
      "งานพระราชทานเพลิงศพ",
      "งานสวดอภิธรรม",
    ].includes(name)
  ) {
    return "งานอวมงคล";
  }
  if (
    [
      "งานประชุมสงฆ์",
      "งานสวดมนต์ข้ามปี",
      "งานเทศมหาชาติ",
      "งานไหว้ครู",
      "งานเฉลิมพระชนมพรรษาพระบรมวงศานุวงศ์",
    ].includes(name)
  ) {
    return "งานศาสนาและพระราชพิธี";
  }
  if (name.startsWith("งาน")) return "งานมงคล";
  return "โอกาสอื่น ๆ";
}

export function groupContexts(contexts: ContextOut[]): ContextGroup[] {
  const buckets = new Map<string, ContextOut[]>();

  contexts.forEach((context) => {
    const groupName = inferGroupName(context);
    const bucket = buckets.get(groupName) ?? [];
    bucket.push(context);
    buckets.set(groupName, bucket);
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => {
      const ai = GROUP_ORDER.indexOf(a);
      const bi = GROUP_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        return (ai === -1 ? GROUP_ORDER.length : ai) - (bi === -1 ? GROUP_ORDER.length : bi);
      }
      return a.localeCompare(b, "th");
    })
    .map(([label, groupItems]) => ({
      label,
      contexts: [...groupItems].sort((a, b) => a.name.localeCompare(b.name, "th")),
    }));
}
