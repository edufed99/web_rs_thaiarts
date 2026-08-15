// lib/server/dashboard-export.ts — build the admin dashboard report as a
// styled Excel workbook (issue #9).
//
// Port of the legacy FastAPI ``services/dashboard_export.py`` onto
// exceljs. The workbook keeps the same sheet layout and tables the old
// export produced so existing spreadsheet consumers do not regress:
// ภาพรวม / แนวโน้ม / ผู้ใช้งาน / คำค้น / หมวดหมู่-บริบท / คุณภาพ /
// กิจกรรมล่าสุด / คำอธิบาย.
//
// Deliberate simplification: exceljs cannot embed the openpyxl charts, so
// the workbook carries the same data tables, formatting, and conditional
// fills instead of chart objects. The README sheet documents the sources.

import ExcelJS from "exceljs";

import type { DashboardOut } from "@/lib/types";

const NAVY = "FF202757";
const PALE = "FFEEF1FA";
const WHITE = "FFFFFFFF";
const GREEN = "FFD9EFD8";
const RED = "FFF7D7D5";
const CREAM = "FFF7E8D0";

function excelDate(value: string): Date | string {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function excelDateTime(value: string): Date | string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function at(values: number[], index: number): number {
  return values[index] ?? 0;
}

function toneLabel(tone: string): string {
  if (tone === "positive") return "เติบโต/ดี";
  if (tone === "warning") return "ต้องติดตาม";
  if (tone === "danger") return "เสี่ยง";
  return "ปกติ";
}

export async function buildDashboardReport(
  payload: DashboardOut,
  generatedBy = "Admin",
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = generatedBy || "Admin";
  workbook.title = "รายงานศูนย์บริหารข้อมูลและติดตามประสิทธิภาพ AI";
  workbook.subject = `Dashboard report — ${payload.range_days} days`;

  buildSummary(workbook.addWorksheet("ภาพรวม"), payload, generatedBy);
  buildActivityTrend(workbook.addWorksheet("แนวโน้ม"), payload);
  buildUsers(workbook.addWorksheet("ผู้ใช้งาน"), payload);
  buildSearch(workbook.addWorksheet("คำค้น"), payload);
  buildCatalog(workbook.addWorksheet("หมวดหมู่-บริบท"), payload);
  buildQuality(workbook.addWorksheet("คุณภาพ"), payload);
  buildRecent(workbook.addWorksheet("กิจกรรมล่าสุด"), payload);
  buildReadme(workbook.addWorksheet("คำอธิบาย"), payload, generatedBy);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function sheetTitle(ws: ExcelJS.Worksheet, text: string, width: number): void {
  ws.mergeCells(1, 1, 2, width);
  const cell = ws.getCell(1, 1);
  cell.value = text;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  cell.font = { name: "Leelawadee UI", size: 20, bold: true, color: { argb: WHITE } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 14;
}

function section(ws: ExcelJS.Worksheet, row: number, text: string, width: number): void {
  ws.mergeCells(row, 1, row, width);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };
  cell.font = { name: "Leelawadee UI", size: 12, bold: true, color: { argb: NAVY } };
  cell.alignment = { vertical: "middle" };
  ws.getRow(row).height = 24;
}

function writeTable(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  headers: string[],
  rows: Array<Array<string | number | Date | null>>,
): void {
  for (let col = 0; col < headers.length; col += 1) {
    const cell = ws.getCell(headerRow, col + 1);
    cell.value = headers[col];
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
    cell.font = { bold: true, color: { argb: NAVY } };
    cell.alignment = { vertical: "middle" };
  }
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      ws.getCell(headerRow + 1 + rowIndex, colIndex + 1).value = value;
    });
  });
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
function buildSummary(ws: ExcelJS.Worksheet, payload: DashboardOut, generatedBy: string): void {
  sheetTitle(ws, "รายงานศูนย์บริหารข้อมูลและติดตามประสิทธิภาพ AI", 8);
  ws.getCell(3, 1).value = `ช่วงข้อมูล ${payload.range_days} วันล่าสุด`;
  ws.getCell(4, 1).value = "สร้างเมื่อ";
  ws.getCell(4, 2).value = excelDateTime(payload.generated_at);
  ws.getCell(4, 2).numFmt = "yyyy-mm-dd hh:mm";
  ws.getCell(4, 4).value = "ผู้ส่งออก";
  ws.getCell(4, 5).value = generatedBy || "Admin";
  ws.getCell(4, 7).value = "แหล่งข้อมูล";
  ws.getCell(4, 8).value = payload.source;

  section(ws, 6, "ตัวชี้วัดหลัก", 8);
  const kpiRows = [
    payload.kpis.members,
    payload.kpis.performances,
    payload.kpis.indices,
    payload.kpis.points,
    payload.kpis.active_users,
    payload.kpis.sessions,
  ].map((tile) => [
    tile.label,
    tile.raw_value,
    tile.delta_pct !== null ? tile.delta_pct / 100 : null,
    toneLabel(tile.tone),
    tile.hint,
  ]);
  writeTable(ws, 7, ["ตัวชี้วัด", "ค่า", "เปลี่ยนแปลง", "สถานะ", "คำอธิบาย"], kpiRows);
  for (let row = 8; row < 8 + kpiRows.length; row += 1) {
    ws.getCell(row, 2).numFmt = "#,##0";
    ws.getCell(row, 3).numFmt = "0.0%";
  }

  const algoRow = 15;
  section(ws, algoRow, "ประสิทธิภาพเส้นทางค้นหา → รายละเอียด", 8);
  const algo = payload.algorithm_kpis;
  const algoRows: Array<Array<string | number>> = [
    ["จำนวนการค้นหา", algo.search_total, "ครั้ง"],
    ["ค้นหาแล้วเปิดรายละเอียด", algo.search_to_detail_total, "ครั้ง"],
    ["อัตรา Search → Detail", algo.search_to_detail_pct / 100, "อัตรา"],
    ["จำนวนการเปิดดูรายการ", algo.items_shown_total, "ครั้ง"],
    ["CTR ต่อผลลัพธ์ที่แสดง", algo.ctr_pct / 100, "อัตรา"],
  ];
  writeTable(ws, algoRow + 1, ["ตัวชี้วัด", "ค่า", "หน่วย"], algoRows);
  ws.getCell(algoRow + 4, 2).numFmt = "0.0%";
  ws.getCell(algoRow + 6, 2).numFmt = "0.0%";

  const qualityRow = 23;
  section(ws, qualityRow, "คุณภาพโมเดลล่าสุด", 8);
  const quality = payload.model_quality;
  const qualityRows: Array<Array<string | number>> = [
    ["nDCG@10", quality.ndcg10, "คุณภาพลำดับผลลัพธ์"],
    ["HR@10", quality.hr10, "สัดส่วนผู้ใช้ที่พบผลลัพธ์ตรงใจ"],
    ["MRR@10", quality.mrr10, "อันดับเฉลี่ยของผลลัพธ์ที่เกี่ยวข้องรายการแรก"],
    ["Coverage", quality.coverage, "ความครอบคลุมรายการในแค็ตตาล็อก"],
    ["Violation rate", quality.violation_rate, "อัตราผลลัพธ์ผิดเงื่อนไขบริบท"],
    ["แหล่งประเมิน", quality.source, "online / offline / unavailable"],
    ["จำนวนผู้ใช้ทดสอบ", quality.test_user_count, "คน"],
    ["จำนวน interaction ทดสอบ", quality.test_interaction_count, "รายการ"],
  ];
  writeTable(ws, qualityRow + 1, ["ตัวชี้วัด", "ค่า", "คำอธิบาย"], qualityRows);
  for (let row = qualityRow + 2; row < qualityRow + 7; row += 1) {
    ws.getCell(row, 2).numFmt = "0.0%";
  }
}

function buildActivityTrend(ws: ExcelJS.Worksheet, payload: DashboardOut): void {
  sheetTitle(ws, "แนวโน้มการใช้งานรายวัน", 12);
  const trend = payload.trend_30d;
  const rows = trend.labels.map((label, index) => [
    excelDate(label),
    at(trend.sessions, index),
    at(trend.searches, index),
    at(trend.ratings, index),
  ]);
  writeTable(ws, 4, ["วันที่", "เซสชัน/กิจกรรม", "การค้นหา", "การให้คะแนน"], rows);
  for (let row = 5; row < 5 + rows.length; row += 1) {
    ws.getCell(row, 1).numFmt = "yyyy-mm-dd";
  }
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
function buildUsers(ws: ExcelJS.Worksheet, payload: DashboardOut): void {
  sheetTitle(ws, "ผู้ใช้งานและช่วงเวลาที่ใช้งาน", 26);
  const growth = payload.user_growth;
  const rows = growth.labels.map((label, index) => [
    excelDate(label),
    at(growth.new_users, index),
    at(growth.active_users, index),
  ]);
  section(ws, 4, "ผู้ใช้ใหม่และผู้ใช้งานประจำวัน", 8);
  writeTable(ws, 5, ["วันที่", "ผู้ใช้ใหม่", "Active users"], rows);
  for (let row = 6; row < 6 + rows.length; row += 1) {
    ws.getCell(row, 1).numFmt = "yyyy-mm-dd";
  }

  const heatmapRow = Math.max(22, 8 + rows.length);
  section(ws, heatmapRow, "Heatmap การใช้งานตามวันและชั่วโมง (UTC)", 26);
  const hours = payload.usage_heatmap.hour_labels ?? Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
  ws.getCell(heatmapRow + 1, 1).value = "วัน / เวลา";
  hours.forEach((hour, index) => {
    ws.getCell(heatmapRow + 1, index + 2).value = hour;
  });
  payload.usage_heatmap.weekday_labels.forEach((dayLabel, dayIndex) => {
    ws.getCell(heatmapRow + 2 + dayIndex, 1).value = dayLabel;
    const values = payload.usage_heatmap.matrix[dayIndex] ?? [];
    values.slice(0, 24).forEach((value, index) => {
      ws.getCell(heatmapRow + 2 + dayIndex, index + 2).value = value;
    });
  });
  const heatmapRange = `B${heatmapRow + 2}:Y${heatmapRow + 8}`;
  ws.addConditionalFormatting({
    ref: heatmapRange,
    rules: [
      {
        priority: 1,
        type: "cellIs",
        operator: "greaterThan",
        formulae: [0],
        style: {
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFB7DED9" } },
        },
      },
    ],
  });
  for (let col = 1; col <= 25; col += 1) {
    const cell = ws.getCell(heatmapRow + 1, col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };
    cell.font = { bold: true, color: { argb: NAVY } };
  }
}

function buildSearch(ws: ExcelJS.Worksheet, payload: DashboardOut): void {
  sheetTitle(ws, "พฤติกรรมการค้นหา", 12);
  section(ws, 4, "Top 5 keyword ที่ผู้ใช้เลือก", 6);
  const keywordRows = payload.top_keywords.items.map((row) => [row.rank, row.term, row.count]);
  writeTable(ws, 5, ["อันดับ", "Keyword", "จำนวนครั้ง"], keywordRows);

  const searchRow = Math.max(18, 8 + keywordRows.length);
  section(ws, searchRow, "คำค้นและสัญญาณต่อเนื่อง", 8);
  const termRows = payload.top_search_terms.items.map((row) => [
    row.rank,
    row.term,
    row.searches,
    row.views,
    row.ratings,
    row.likes,
    row.score,
  ]);
  writeTable(ws, searchRow + 1, ["อันดับ", "คำค้น", "ค้นหา", "เปิดดู", "ให้คะแนน", "ถูกใจ", "คะแนนถ่วงน้ำหนัก"], termRows);
}

function buildCatalog(ws: ExcelJS.Worksheet, payload: DashboardOut): void {
  sheetTitle(ws, "ประเภทชุดการแสดงและบริบทยอดนิยม", 14);
  section(ws, 4, "ประเภทชุดการแสดง", 6);
  const categoryRows = payload.popular_categories.items.map((row) => [row.name, row.count, row.pct / 100]);
  writeTable(ws, 5, ["หมวดหมู่", "จำนวนรายการ", "สัดส่วน"], categoryRows);
  for (let row = 6; row < 6 + categoryRows.length; row += 1) {
    ws.getCell(row, 3).numFmt = "0.0%";
  }

  const contextRow = Math.max(20, 8 + categoryRows.length);
  section(ws, contextRow, "บริบทย่อยตามจำนวน Recommendation request", 6);
  const contextRows = payload.popular_subcontexts.items.map((row) => [row.name, row.count, row.pct / 100]);
  writeTable(ws, contextRow + 1, ["บริบทย่อย", "จำนวน Request", "สัดส่วน"], contextRows);
  for (let row = contextRow + 2; row < contextRow + 1 + contextRows.length; row += 1) {
    ws.getCell(row, 3).numFmt = "0.0%";
  }
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
function buildQuality(ws: ExcelJS.Worksheet, payload: DashboardOut): void {
  sheetTitle(ws, "คุณภาพโมเดลและคุณภาพข้อมูล", 12);
  const quality = payload.model_quality;
  section(ws, 4, "คุณภาพโมเดลล่าสุด", 8);
  const modelRows = [
    ["nDCG@10", quality.ndcg10],
    ["HR@10", quality.hr10],
    ["MRR@10", quality.mrr10],
    ["Coverage", quality.coverage],
    ["Violation rate", quality.violation_rate],
  ];
  writeTable(ws, 5, ["Metric", "ค่า"], modelRows);
  for (let row = 6; row < 6 + modelRows.length; row += 1) {
    ws.getCell(row, 2).numFmt = "0.0%";
  }
  ws.getCell(5, 4).value = "แหล่งประเมิน";
  ws.getCell(5, 5).value = quality.source;
  ws.getCell(6, 4).value = "ประเมินเมื่อ";
  ws.getCell(6, 5).value = quality.ran_at ? excelDateTime(quality.ran_at) : null;
  ws.getCell(6, 5).numFmt = "yyyy-mm-dd hh:mm";
  ws.getCell(7, 4).value = "ผู้ใช้ทดสอบ";
  ws.getCell(7, 5).value = quality.test_user_count;
  ws.getCell(8, 4).value = "Interactions ทดสอบ";
  ws.getCell(8, 5).value = quality.test_interaction_count;

  const trendRow = 13;
  section(ws, trendRow, "แนวโน้มคุณภาพโมเดล 30 วัน", 8);
  const trend = payload.quality_trend_30d;
  const trendRows = trend.labels.map((label, index) => [
    excelDate(label),
    at(trend.ndcg10, index),
    at(trend.hr10, index),
    at(trend.mrr10, index),
  ]);
  writeTable(ws, trendRow + 1, ["วันที่", "nDCG@10", "HR@10", "MRR@10"], trendRows);
  for (let row = trendRow + 2; row < trendRow + 1 + trendRows.length; row += 1) {
    ws.getCell(row, 1).numFmt = "yyyy-mm-dd";
    ws.getCell(row, 2).numFmt = "0.0%";
    ws.getCell(row, 3).numFmt = "0.0%";
    ws.getCell(row, 4).numFmt = "0.0%";
  }

  const dataRow = Math.max(31, trendRow + 4 + trendRows.length);
  section(ws, dataRow, "คุณภาพและความครบถ้วนของข้อมูล", 8);
  const metrics = payload.page_quality.metrics;
  const headersRow = dataRow + 1;
  const rows = metrics.map((metric) => [metric.name, metric.value / 100, metric.target / 100, null, null]);
  writeTable(ws, headersRow, ["มิติคุณภาพ", "ค่าปัจจุบัน", "เป้าหมาย", "ส่วนต่าง", "ผลประเมิน"], rows);
  metrics.forEach((metric, offset) => {
    const row = headersRow + 1 + offset;
    ws.getCell(row, 4).value = { formula: `B${row}-C${row}` };
    ws.getCell(row, 5).value = { formula: `IF(B${row}>=C${row},"ผ่าน","ต้องปรับปรุง")` };
    ws.getCell(row, 5).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: metric.value >= metric.target ? GREEN : RED },
    };
  });
  for (let row = headersRow + 1; row < headersRow + 1 + metrics.length; row += 1) {
    ws.getCell(row, 2).numFmt = "0.0%";
    ws.getCell(row, 3).numFmt = "0.0%";
    ws.getCell(row, 4).numFmt = "0.0%";
  }
  ws.getCell(headersRow + metrics.length + 2, 1).value = "ประเด็นที่ต้องแก้ไข";
  ws.getCell(headersRow + metrics.length + 2, 2).value = payload.page_quality.open_issues;
}

function buildRecent(ws: ExcelJS.Worksheet, payload: DashboardOut): void {
  sheetTitle(ws, "กิจกรรมล่าสุดในระบบ", 10);
  const rows = payload.recent_activity.items.map((row) => [
    row.log_id,
    excelDateTime(row.time),
    row.user,
    row.action,
    row.type,
    row.target,
  ]);
  writeTable(ws, 4, ["Log ID", "เวลา", "ผู้ใช้", "Action", "ประเภท", "เป้าหมาย"], rows);
  for (let row = 5; row < 5 + rows.length; row += 1) {
    ws.getCell(row, 2).numFmt = "yyyy-mm-dd hh:mm";
  }
}

function buildReadme(ws: ExcelJS.Worksheet, payload: DashboardOut, generatedBy: string): void {
  sheetTitle(ws, "คำอธิบายรายงานและที่มาของข้อมูล", 8);
  const rows: Array<Array<string | number>> = [
    ["ชื่อรายงาน", "ศูนย์บริหารข้อมูลและติดตามประสิทธิภาพ AI"],
    ["ช่วงเวลา", `${payload.range_days} วันล่าสุด`],
    ["ผู้ส่งออก", generatedBy || "Admin"],
    ["แหล่งข้อมูล", payload.source],
    ["API ต้นทาง", "/api/metrics/dashboard (Next.js Application Backend)"],
    ["Sessions", "จำนวนกิจกรรมรวมรายวัน; ใช้สำหรับดูแนวโน้มการใช้งาน"],
    ["Active users", "จำนวน user_key ที่ไม่ซ้ำในช่วงเวลา"],
    ["Search → Detail", "ผู้ใช้ที่ค้นหาแล้วเปิดหน้ารายละเอียดในช่วงวิเคราะห์"],
    ["nDCG@10", "คุณภาพการเรียงลำดับผลลัพธ์ 10 อันดับแรก; ค่ายิ่งสูงยิ่งดี"],
    ["HR@10", "สัดส่วนผู้ใช้ที่พบผลลัพธ์เกี่ยวข้องภายใน 10 อันดับแรก"],
    ["MRR@10", "อันดับเฉลี่ยแบบ reciprocal ของผลลัพธ์เกี่ยวข้องรายการแรก"],
    ["Coverage", "สัดส่วนรายการในแค็ตตาล็อกที่ระบบสามารถแนะนำได้"],
    ["Violation rate", "สัดส่วนผลลัพธ์ที่ผิดเงื่อนไขบริบท; ค่ายิ่งต่ำยิ่งดี"],
    ["Top keyword", "คำสำคัญที่ผู้ใช้เลือกใน recommendation request และ search telemetry"],
    ["หมายเหตุ", "รายงานเป็น snapshot ณ เวลาส่งออก ตัวเลขอาจเปลี่ยนเมื่อระบบมีข้อมูลใหม่"],
    ["หมายเหตุ 2", "ข้อมูลมาจาก Postgres ผ่าน Next.js; แผนภูมิในรายงานรุ่นเดิมถูกแทนด้วยตารางข้อมูลชุดเดียวกัน"],
  ];
  writeTable(ws, 4, ["หัวข้อ", "คำอธิบาย"], rows);
  ws.getColumn(2).width = 90;
  for (let row = 5; row < 5 + rows.length; row += 1) {
    ws.getCell(row, 2).alignment = { vertical: "top", wrapText: true };
  }
}
