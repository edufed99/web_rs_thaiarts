import { groupContexts } from "./contextGroups";
import type { ContextOut } from "./types";

const OCCASION_IMAGES = [
  "/img/home/occasion-1.png",
  "/img/home/occasion-2.png",
  "/img/home/occasion-3.png",
  "/img/home/occasion-4.png",
  "/img/home/occasion-5.png",
] as const;

const OCCASION_IMAGE_BY_GROUP: Record<string, string> = {
  "งานมงคล": "/img/home/occasion-1.png",
  "งานเทศกาล": "/img/home/occasion-2.png",
  "งานเผยแพร่วัฒนธรรม": "/img/home/occasion-3.png",
  "งานวันสำคัญทางศาสนา": "/img/home/occasion-4.png",
  "งานอวมงคล": "/img/home/occasion-5.png",
};

const OCCASION_IMAGE_BY_NAME: Record<string, string> = {
  "งานขึ้นบ้านใหม่": "/img/home/occasion-housewarming.jpg",
  "งานแต่งงาน": "/img/home/occasion-wedding.jpg",
  "งานทำบุญ": "/img/home/occasion-merit-making.jpg",
  "งานบวงสรวง": "/img/home/occasion-worship-ceremony.jpg",
  "งานเปิดบริษัท": "/img/home/occasion-company-opening.jpg",
  "งานวันเกิด": "/img/home/occasion-birthday.jpg",
  "งานไหว้ครู": "/img/home/occasion-wai-khru.jpg",
  "งานเฉลิมพระชนมพรรษาพระบรมวงศานุวงศ์": "/img/home/occasion-royal-birthday.jpg",
  "งานเทศมหาชาติ": "/img/home/occasion-maha-chat.jpg",
  "งานประชุมสงฆ์": "/img/home/occasion-monks-conference.jpg",
  "วันเข้าพรรษา": "/img/home/occasion-buddhist-lent.jpg",
  "งานสวดมนต์ข้ามปี": "/img/home/occasion-new-year-prayer.jpg",
  "วันวิสาขบูชา": "/img/home/occasion-visakha-bucha.jpg",
  "วันออกพรรษา": "/img/home/occasion-end-buddhist-lent.jpg",
  "งานสวดอภิธรรม": "/img/home/occasion-funeral-prayer.jpg",
  "งานฌาปนกิจศพ": "/img/home/occasion-cremation.jpg",
  "งานพระราชทานเพลิงศพ": "/img/home/occasion-royal-cremation.jpg",
  "วันขึ้นปีใหม่": "/img/home/occasion-new-year.jpg",
  "วันตรุษจีน": "/img/home/occasion-chinese-new-year.jpg",
  "วันลอยกระทง": "/img/home/occasion-loy-krathong.jpg",
  "วันสงกรานต์": "/img/home/occasion-songkran.jpg",
  "การเผยแพร่วัฒนธรรมต่างประเทศ": "/img/home/occasion-cultural-abroad.jpg",
  "งานเผยแพร่วัฒนธรรมต่างประเทศ": "/img/home/occasion-cultural-abroad.jpg",
  "การเผยแพร่วัฒนธรรมในประเทศ": "/img/home/occasion-cultural-domestic.jpg",
  "งานเผยแพร่วัฒนธรรมในประเทศ": "/img/home/occasion-cultural-domestic.jpg",
  "งานสโมสรสันนิบาต": "/img/home/occasion-state-banquet.jpg",
  "งานต้อนรับอาคันตุกะ": "/img/home/occasion-guest-reception.jpg",
};

export interface OccasionSummary {
  context: ContextOut;
  groupLabel: string;
}

export function buildOccasionSummaries(contexts: ContextOut[]): OccasionSummary[] {
  return groupContexts(contexts).flatMap((group) =>
    group.contexts.map((context) => ({
      context,
      groupLabel: group.label,
    })),
  );
}

export function occasionImageFor(
  contextName: string,
  groupLabel: string,
  idx: number,
): string {
  return (
    OCCASION_IMAGE_BY_NAME[contextName] ??
    OCCASION_IMAGE_BY_GROUP[groupLabel] ??
    OCCASION_IMAGES[idx % OCCASION_IMAGES.length]
  );
}
