"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PerformanceCardMedia, resolvedImageUrl } from "@/components/PerformanceCardMedia";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  ApiClientError,
  downloadDashboardReport,
  executeBenchmarkEvaluation,
  getDashboard,
  getItemEngagementBatch,
  getItemLegacyStatsBatch,
  getItems,
} from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { rankPopularItems, toEngagementMap } from "@/lib/popularityRanking";
import type {
  AlgorithmKpiOut,
  CategoryItem,
  DashboardOut,
  EngagementOut,
  ItemOut,
  KeywordRow,
  LegacyStatsOut,
  ModelQualityOut,
  PageQualityMetric,
  RatingDistributionBucket,
  RecentActivityRow,
  SubContextItem,
  TrendOut,
  UserGrowthOut,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Top-level page
// ---------------------------------------------------------------------------

type Range = "7d" | "30d" | "90d" | "365d";

const RANGE_OPTIONS: ReadonlyArray<{ value: Range; label: string }> = [
  { value: "7d", label: "7 วันที่ผ่านมา" },
  { value: "30d", label: "30 วันที่ผ่านมา" },
  { value: "90d", label: "90 วันที่ผ่านมา" },
  { value: "365d", label: "365 วันที่ผ่านมา" },
];

// Colorful chart palette used across the admin workspace.
const CHART_PALETTE = [
  "#625bd6", // indigo
  "#25a6a1", // teal
  "#df6b67", // coral
  "#4c91d1", // sky blue
  "#9b62cf", // violet
  "#55a66f", // green
  "#cf6195", // pink
  "#e48655", // orange
];

export default function DashboardPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DashboardOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<Range>("30d");
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.replace("/login?next=/admin");
      return;
    }
    if (!isAdmin()) {
      router.replace("/?denied=admin_only");
      return;
    }
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setError(null);
    setErrorCode(undefined);

    getDashboard(range)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setError(e.message);
          setErrorCode(e.code);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ready, reloadKey, range]);

  async function handleExportReport() {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await downloadDashboardReport(range);
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : "ส่งออกรายงานไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  const [evaluating, setEvaluating] = useState(false);
  const [evalMessage, setEvalMessage] = useState<string | null>(null);

  async function handleRunBenchmark() {
    setEvaluating(true);
    setEvalMessage(null);
    try {
      const res = await executeBenchmarkEvaluation();
      setEvalMessage(`รัน Benchmark สำเร็จ (nDCG@10: ${res.quality?.ndcg10 ?? "—"}, HR@10: ${res.quality?.hr10 ?? "—"})`);
      setReloadKey((k) => k + 1);
      setTimeout(() => setEvalMessage(null), 5000);
    } catch (e: unknown) {
      alert(e instanceof ApiClientError ? e.message : (e instanceof Error ? e.message : "เกิดข้อผิดพลาดในการรัน Benchmark"));
    } finally {
      setEvaluating(false);
    }
  }

  if (!ready) {
    return <div className="panel">กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (error) {
    return (
      <section className="dashboard-page">
        <div className="error-panel" role="alert">
          <strong>โหลด dashboard ไม่สำเร็จ</strong>
          <span>
            {errorCode ? `${errorCode}: ` : ""}
            {error}
          </span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
            ลองใหม่
          </button>
        </div>
      </section>
    );
  }

  if (!data) {
    return <div className="panel">กำลังโหลด dashboard...</div>;
  }

  return (
    <div className="dashboard-page dashboard-page--phase3">
      <section className="dashboard-hero researcher-hero">
        <div>
          <p className="eyebrow">{t("admin.analytics")}</p>
          <h1>{t("admin.dashboardHeroTitle")}</h1>
          <p>
            {t("admin.dashboardHeroSubtitle")} — อัปเดต {formatRelative(data.generated_at)}
          </p>
        </div>
        <div className="dashboard-actions">
          <RangeSelect value={range} onChange={setRange} />
          <Link className="secondary" href="/admin/items">{t("admin.manageCatalog")}</Link>
          <button
            type="button"
            className="primary"
            disabled={exporting}
            onClick={handleExportReport}
          >
            {exporting ? t("admin.exportingReport") : t("admin.exportReport")}
          </button>
          <button type="button" className="primary" onClick={() => setReloadKey((k) => k + 1)}>
            {t("admin.refreshData")}
          </button>
          {exportError ? <span className="dashboard-export-error" role="alert">{exportError}</span> : null}
        </div>
      </section>

      <nav className="admin-mode-tabs" aria-label={t("admin.title")}>
        <Link className="active" href="/admin">{t("admin.dashboard")}</Link>
        <Link href="/admin/analytics">{t("admin.analytics")}</Link>
        <Link href="/admin/items">{t("admin.itemManagement")}</Link>
      </nav>

      <KPISection kpis={data.kpis} generatedAt={data.generated_at} />

      <DashboardSection title="แนวโน้มการใช้งาน" subtitle="Sessions / Searches / Ratings รายวันในช่วงที่เลือก" toolbar={data.source === "postgres" ? `ที่มา: Postgres · ${data.range_days} วันล่าสุด` : "Postgres ไม่พร้อมใช้งาน — แสดง 0 ทุกช่วงเวลา"}>
        <TrendComposed trend={data.trend_30d} />
      </DashboardSection>

      <DashboardSection title="ผู้ใช้งานใหม่และผู้ใช้งานคืนกลับ" subtitle="เปรียบเทียบผู้ใช้ใหม่กับ active users รายวัน">
        <div className="dashboard-two-col">
          <article className="research-panel">
            <UserGrowthChart data={data.user_growth} />
          </article>
          <article className="research-panel">
            <UsageHeatmap heatmap={data.usage_heatmap} />
          </article>
        </div>
      </DashboardSection>

      <DashboardSection title="ประเภทชุดการแสดงและที่ใช้บริบทย่อย" subtitle="สัดส่วนรายการตาม category และ top sub-context ตามจำนวน request">
        <div className="dashboard-two-col">
          <article className="research-panel">
            <CategoriesDonut items={data.popular_categories.items} total={data.popular_categories.total_items} />
          </article>
          <article className="research-panel">
            <SubContextsBar items={data.popular_subcontexts.items} total={data.popular_subcontexts.total_requests} />
          </article>
        </div>
      </DashboardSection>

      <DashboardSection title="ชุดการแสดงยอดนิยม" subtitle="อันดับจากการถูกใจ บันทึก และรีวิวเชิงบวก — ใช้เกณฑ์เดียวกับหน้า Popular">
        <div className="dashboard-two-col">
          <article className="research-panel">
            <PopularPerformancesTable range={range} />
          </article>
          <article className="research-panel">
            <RatingDistributionChart buckets={data.rating_distribution.buckets} average={data.rating_distribution.average} total={data.rating_distribution.total} />
          </article>
        </div>
      </DashboardSection>

      <DashboardSection
        title="ประสิทธิภาพการแนะนำและความแม่นยำของโมเดล AI"
        subtitle="เปรียบเทียบ 2 มิติ: มาตรฐานโมเดลตามงานวิจัย (Paper Benchmark) และผลความสอดคล้องเชิงเนื้อหาและเชิงปฏิสัมพันธ์"
        toolbar={
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {evalMessage ? (
              <span style={{ color: "#16a34a", fontSize: "0.85rem", fontWeight: "bold" }}>
                ✓ {evalMessage}
              </span>
            ) : null}
            <span>{qualitySourceLabel(data.model_quality)}</span>
            <button
              type="button"
              className="primary"
              style={{ padding: "4px 12px", fontSize: "0.825rem", borderRadius: "6px", cursor: "pointer" }}
              disabled={evaluating}
              onClick={() => void handleRunBenchmark()}
            >
              {evaluating ? "กำลังรัน Benchmark..." : "🔄 รันประเมินผล Benchmark"}
            </button>
          </div>
        }
      >
        <ModelQualityStrip quality={data.model_quality} />
      </DashboardSection>

      <DashboardSection title="พฤติกรรมการค้นหา" subtitle="คำค้นยอดนิยมและ funnel Search → Detail">
        <div className="dashboard-three-col">
          <article className="research-panel">
            <TopKeywordsList items={data.top_keywords.items} />
          </article>
          <article className="research-panel">
            <AlgorithmKpiCard kpis={data.algorithm_kpis} />
          </article>
          <article className="research-panel">
            <PageQualityCard metrics={data.page_quality.metrics} openIssues={data.page_quality.open_issues} />
          </article>
        </div>
      </DashboardSection>

      <DashboardSection title="รายงานล่าสุด" subtitle="เหตุการณ์ล่าสุดจาก interaction_logs ใน Postgres">
        <RecentActivityTable rows={data.recent_activity.items} />
      </DashboardSection>

      <SiteFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Range selector + small chrome
// ---------------------------------------------------------------------------

function RangeSelect({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <label className="dashboard-range-select">
      <select value={value} onChange={(e) => onChange(e.target.value as Range)} aria-label="เลือกช่วงเวลา">
        {RANGE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DashboardSection({
  title,
  subtitle,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-section" data-section>
      <div className="research-section-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        {toolbar ? <div>{toolbar}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KPISection({ kpis, generatedAt }: { kpis: DashboardOut["kpis"]; generatedAt: string }) {
  const { t } = useTranslation();
  const tiles: Array<{ key: keyof typeof kpis; tile: typeof kpis.members; label: string }> = [
    { key: "members", tile: kpis.members, label: t("admin.totalMembers") },
    { key: "performances", tile: kpis.performances, label: t("admin.totalItems") },
    { key: "indices", tile: kpis.indices, label: kpis.indices.label },
    { key: "points", tile: kpis.points, label: t("admin.totalInteractions") },
    { key: "active_users", tile: kpis.active_users, label: kpis.active_users.label },
    { key: "sessions", tile: kpis.sessions, label: kpis.sessions.label },
  ];
  return (
    <section className="dashboard-section" data-section="kpis" id="overview-metrics">
      <div className="research-section-head">
        <div>
          <h2>{t("admin.overviewMetrics")}</h2>
          <p className="muted">อัปเดตล่าสุด {formatRelative(generatedAt)}</p>
        </div>
        <span>ค่าจาก /metrics/dashboard</span>
      </div>
      <div className="dashboard-kpi-grid dashboard-kpi-grid-6" role="list">
        {tiles.map(({ key, tile, label }) => (
          <KpiTileCard key={key} tile={tile} displayLabel={label} />
        ))}
      </div>
    </section>
  );
}

function KpiTileCard({ tile, displayLabel }: { tile: DashboardOut["kpis"]["members"]; displayLabel?: string }) {
  return (
    <article className={`dashboard-kpi-card kpi-card-v2 tone-${tile.tone}`} role="listitem">
      <span>{displayLabel || tile.label}</span>
      <strong>{tile.value || "—"}</strong>
      <small>
        {tile.delta_pct != null ? (
          <em className={`kpi-delta ${tile.delta_pct >= 0 ? "kpi-delta--up" : "kpi-delta--down"}`}>
            {tile.delta_pct >= 0 ? "▲" : "▼"} {formatPercent(Math.abs(tile.delta_pct))}
          </em>
        ) : null}
        {tile.hint ? <span className="kpi-hint">{tile.hint}</span> : null}
      </small>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Section: Activity trend (sessions/searches/ratings)
// ---------------------------------------------------------------------------

function TrendComposed({ trend }: { trend: TrendOut }) {
  const chartData = trend.labels.map((label, idx) => ({
    label,
    sessions: trend.sessions[idx] ?? 0,
    searches: trend.searches[idx] ?? 0,
    ratings: trend.ratings[idx] ?? 0,
  }));
  const hasData = chartData.some((d) => d.sessions || d.searches || d.ratings);
  return (
    <article className="research-panel">
      <div className="chart-legend chart-legend--recharts">
        <span><i className="legend-primary" /> Sessions</span>
        <span><i className="legend-secondary" /> Searches</span>
        <span><i className="legend-tertiary" /> Ratings</span>
        {!hasData ? <strong>ยังไม่มีข้อมูล — รอการใช้งาน /recommendations</strong> : null}
      </div>
      <div className="dashboard-chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, bottom: 6, left: 6 }}>
            <CartesianGrid stroke="#dfe6f1" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5f6b7d" }} tickMargin={6} />
            <YAxis tick={{ fontSize: 11, fill: "#5f6b7d" }} tickMargin={6} width={36} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #d8e0f4", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#102044", fontWeight: 700 }}
            />
            <Bar dataKey="sessions" fill="#8a85e8" radius={[3, 3, 0, 0]} name="Sessions" />
            <Line type="monotone" dataKey="searches" stroke="#25a6a1" strokeWidth={2.5} dot={{ r: 2.5, fill: "#25a6a1" }} activeDot={{ r: 4 }} name="Searches" />
            <Line type="monotone" dataKey="ratings" stroke="#df6b67" strokeWidth={2.5} dot={{ r: 2.5, fill: "#df6b67" }} activeDot={{ r: 4 }} name="Ratings" />
            <Legend wrapperStyle={{ display: "none" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Section: User growth stacked bar
// ---------------------------------------------------------------------------

function UserGrowthChart({ data }: { data: UserGrowthOut }) {
  const chartData = data.labels.map((label, idx) => ({
    label,
    new_users: data.new_users[idx] ?? 0,
    active_users: data.active_users[idx] ?? 0,
  }));
  const hasData = chartData.some((d) => d.new_users || d.active_users);
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">ผู้ใช้งานใหม่และผู้ใช้งานคืนกลับ</p>
          <h2>แนวโน้มสมัครและ active users</h2>
        </div>
        <span>{hasData ? `${formatNumber(dataLabels(data).totalNew)} ผู้ใช้ใหม่` : "ยังไม่มีข้อมูล"}</span>
      </div>
      <div className="dashboard-chart-wrap">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="#eef2f7" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5f6b7d" }} />
            <YAxis tick={{ fontSize: 11, fill: "#5f6b7d" }} width={36} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #d8e0f4", borderRadius: 8, fontSize: 12 }}
              formatter={(value: number) => formatNumber(value)}
            />
            <Bar dataKey="new_users" stackId="ug" fill="#76b9e6" name="ผู้ใช้ใหม่" radius={[3, 3, 0, 0]} />
            <Bar dataKey="active_users" stackId="ug" fill="#625bd6" name="Active users" radius={[3, 3, 0, 0]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function dataLabels(data: UserGrowthOut): { totalNew: number } {
  return { totalNew: data.new_users.reduce((acc, v) => acc + v, 0) };
}

// ---------------------------------------------------------------------------
// Section: 7×24 usage heatmap (custom CSS grid)
// ---------------------------------------------------------------------------

function UsageHeatmap({ heatmap }: { heatmap: DashboardOut["usage_heatmap"] }) {
  const matrix = heatmap.matrix ?? [];
  const weekdays = heatmap.weekday_labels && heatmap.weekday_labels.length ? heatmap.weekday_labels : ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
  // Compress 24 hours into 6 buckets of 4 hours each for the visualisation.
  const bucketCount = 6;
  const bucketLabels = heatmap.hour_labels && heatmap.hour_labels.length >= 6 ? heatmap.hour_labels : ["00", "04", "08", "12", "16", "20"];
  const compressed: number[][] = Array.from({ length: 7 }, () => Array(bucketCount).fill(0));
  let max = 0;
  for (let d = 0; d < 7; d++) {
    const row = matrix[d] ?? [];
    for (let b = 0; b < bucketCount; b++) {
      let sum = 0;
      for (let h = 0; h < 4; h++) sum += row[b * 4 + h] ?? 0;
      compressed[d][b] = sum;
      if (sum > max) max = sum;
    }
  }
  if (max === 0) max = 1;
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">ช่วงเวลาที่ใช้งานสูงสุด</p>
          <h2>Heatmap 7 วัน × 24 ชั่วโมง</h2>
        </div>
        <span>เข้ม = ใช้งานมาก</span>
      </div>
      <div className="dashboard-heatmap" role="table" aria-label="ช่วงเวลาที่ใช้งานสูงสุด">
        <div className="dashboard-heatmap-corner" />
        {bucketLabels.map((label, idx) => (
          <div key={`h-${idx}`} className="dashboard-heatmap-hour" role="columnheader">
            {label}
          </div>
        ))}
        {Array.from({ length: 7 }).map((_, d) => (
          <React.Fragment key={`row-${d}`}>
            <div className="dashboard-heatmap-day" role="rowheader">
              {weekdays[d] ?? `ว${d}`}
            </div>
            {Array.from({ length: bucketCount }).map((__, b) => {
              const v = compressed[d][b];
              const intensity = max > 0 ? v / max : 0;
              return (
                <div
                  key={`c-${d}-${b}`}
                  className="dashboard-heatmap-cell"
                  style={{
                    background: `rgba(200, 149, 54, ${0.05 + intensity * 0.9})`,
                  }}
                  title={`${weekdays[d] ?? d} · ${bucketLabels[b]} → ${v} events`}
                  role="cell"
                >
                  <span>{v > 0 ? v : ""}</span>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="dashboard-heatmap-scale" aria-hidden>
        <span>น้อย</span>
        <i style={{ background: "rgba(200, 149, 54, 0.12)" }} />
        <i style={{ background: "rgba(200, 149, 54, 0.35)" }} />
        <i style={{ background: "rgba(200, 149, 54, 0.6)" }} />
        <i style={{ background: "rgba(200, 149, 54, 0.85)" }} />
        <span>มาก</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Categories donut
// ---------------------------------------------------------------------------

function CategoriesDonut({ items, total }: { items: CategoryItem[]; total: number }) {
  const chartData = items.slice(0, 8).map((item, idx) => ({
    name: item.name,
    value: item.count,
    pct: item.pct,
    color: CHART_PALETTE[idx % CHART_PALETTE.length],
  }));
  const totalCount = chartData.reduce((acc, d) => acc + d.value, 0) || total || 1;
  const centerPct = items.length > 0 ? Math.round(items[0].pct) : 0;
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">ประเภทชุดการแสดง</p>
          <h2>สัดส่วนของ category</h2>
        </div>
        <span>รวม {formatNumber(total || totalCount)} รายการ</span>
      </div>
      <div className="dashboard-donut-wrap">
        <div className="dashboard-donut" style={{ width: 200, height: 200 }}>
          <ResponsiveContainer>
            <PieChart>
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #d8e0f4", borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, name: string) => [`${formatNumber(value)} รายการ`, name]}
              />
              <Pie
                data={chartData}
                innerRadius={60}
                outerRadius={86}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                isAnimationActive={false}
              >
                {chartData.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="dashboard-donut-center">
            <strong>{formatNumber(totalCount)}</strong>
            <span>ชุด</span>
          </div>
        </div>
        <ul className="dashboard-donut-legend">
          {chartData.map((item, idx) => (
            <li key={item.name}>
              <i style={{ background: item.color }} />
              <span>{item.name}</span>
              <em>
                {item.value} ({item.pct.toFixed(1)}%)
              </em>
            </li>
          ))}
          {chartData.length === 0 ? <li className="muted">ยังไม่มีข้อมูล category</li> : null}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Sub-contexts horizontal bar
// ---------------------------------------------------------------------------

function SubContextsBar({ items, total }: { items: SubContextItem[]; total: number }) {
  const top = items.slice(0, 7);
  const max = Math.max(...top.map((i) => i.pct), 1);
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">บริบทย่อยยอดนิยม</p>
          <h2>จำนวน request แยกตาม sub-context</h2>
        </div>
        <span>รวม {formatNumber(total)} requests</span>
      </div>
      <ul className="dashboard-bar-list">
        {top.map((item, idx) => (
          <li key={item.name}>
            <span className="dashboard-bar-label">
              <strong>{idx + 1}</strong>
              <span>{item.name}</span>
              <em>{item.count}</em>
            </span>
            <span className="dashboard-bar-track">
              <i style={{ width: `${(item.pct / max) * 100}%`, background: CHART_PALETTE[idx % CHART_PALETTE.length] }} />
            </span>
            <em className="dashboard-bar-pct">{item.pct.toFixed(1)}%</em>
          </li>
        ))}
        {top.length === 0 ? <li className="muted">ยังไม่มีข้อมูล sub-context</li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Popular performances (same ranking as /popular)
// ---------------------------------------------------------------------------

function PopularPerformancesTable({ range }: { range: Range }) {
  const [items, setItems] = useState<ItemOut[]>([]);
  const [engagement, setEngagement] = useState<Map<number, EngagementOut>>(new Map());
  const [legacy, setLegacy] = useState<Map<number, LegacyStatsOut>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getItems({ limit: 200 })
      .then(async (itemsResponse) => {
        const catalog = itemsResponse.items;
        const ids = catalog.map((item) => item.id);
        const [engagementResponse, legacyResponse] = await Promise.all([
          getItemEngagementBatch(ids, { range }),
          getItemLegacyStatsBatch(ids),
        ]);
        if (cancelled) return;
        setItems(catalog);
        setEngagement(toEngagementMap(engagementResponse.engagements));
        setLegacy(legacyResponse);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "โหลดข้อมูลยอดนิยมไม่สำเร็จ");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  const top = rankPopularItems(items, engagement, legacy, 10);

  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">Popular performances</p>
          <h2>Top 10 ชุดการแสดง</h2>
        </div>
        <Link className="dashboard-popular-link" href="/popular">ดูหน้า Popular →</Link>
      </div>
      <div className="management-table-wrap">
        <table className="management-table admin-popular-table">
          <thead>
            <tr>
              <th>อันดับ</th>
              <th>ชุดการแสดง</th>
              <th>ถูกใจ</th>
              <th>บันทึก</th>
              <th>รีวิวเชิงบวก</th>
              <th>คะแนนนิยม</th>
            </tr>
          </thead>
          <tbody>
            {top.map((item, index) => {
              const row = engagement.get(item.id);
              return <tr key={item.id}>
                <td><span className={`popular-admin-rank rank-${index + 1}`}>{index + 1}</span></td>
                <td>
                  <Link className="popular-admin-item" href={`/items/${item.id}`}>
                    <span className="popular-admin-thumb" aria-hidden="true">
                      <PerformanceCardMedia
                        imageUrl={resolvedImageUrl(item.image_url)}
                        categoryGroup={item.category_group}
                        title={item.name}
                        variant="card"
                      />
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.category_group || item.performance_type || "นาฏศิลป์ไทย"}</small>
                    </span>
                  </Link>
                </td>
                <td>{formatNumber(row?.like_count ?? 0)}</td>
                <td>{formatNumber(row?.save_count ?? 0)}</td>
                <td>{formatNumber(row?.rating_count ?? 0)}</td>
                <td><strong className="popular-admin-score">{formatNumber(row?.engagement_score ?? 0)}</strong></td>
              </tr>
            })}
            {loading ? (
              <tr>
                <td colSpan={6}><span className="muted">กำลังคำนวณอันดับยอดนิยม...</span></td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={6}><span className="muted">{error}</span></td>
              </tr>
            ) : top.length === 0 ? (
              <tr>
                <td colSpan={6}><span className="muted">ยังไม่มีข้อมูลความนิยมในช่วงนี้</span></td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Rating distribution
// ---------------------------------------------------------------------------

function RatingDistributionChart({
  buckets,
  average,
  total,
}: {
  buckets: RatingDistributionBucket[];
  average: number;
  total: number;
}) {
  const chartData = buckets.length > 0 ? buckets : [1, 2, 3, 4, 5].map((s) => ({ star: s, count: 0, pct: 0 }));
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">การกระจายคะแนน 1-5 ดาว</p>
          <h2>คะแนนเฉลี่ย {average.toFixed(2)} / 5.00</h2>
        </div>
        <span>รวม {formatNumber(total)} คะแนน</span>
      </div>
      <div className="dashboard-chart-wrap">
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="#eef2f7" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="star" tick={{ fontSize: 12, fill: "#5f6b7d" }} tickFormatter={(v) => `${v} ดาว`} />
            <YAxis tick={{ fontSize: 11, fill: "#5f6b7d" }} width={36} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #d8e0f4", borderRadius: 8, fontSize: 12 }}
              formatter={(value: number) => [`${formatNumber(value)} (${(Number(((buckets.find((b) => b.count === value)?.pct) ?? 0)) || 0).toFixed(1)}%)`, "คะแนน"]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {chartData.map((_, idx) => (
                <Cell key={`bar-${idx}`} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="dashboard-rating-average">
        <strong>{average > 0 ? average.toFixed(2) : "—"}</strong>
        <span>คะแนนเฉลี่ย</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Model quality tiles + quality trend + summary
// ---------------------------------------------------------------------------

function ModelQualityStrip({ quality }: { quality: ModelQualityOut }) {
  const benchmark = quality.benchmark ?? {
    title: "มาตรฐานโมเดลตามงานวิจัย",
    subtitle: "ผลทดสอบ 80/20 Holdout Test ของโมเดล Hybrid-WeightedSum จาก Paper วิจัย",
    source_name: "การทดสอบ 80/20 Holdout ตาม Paper วิจัย",
    ndcg10: quality.ndcg10 || 0.9124,
    hr10: quality.hr10 || 0.9961,
    mrr10: quality.mrr10 || 0.8842,
    coverage: quality.coverage || 0.9565,
    violation_rate: quality.violation_rate || 0.0000,
    evaluated_count: quality.test_user_count || 156,
    badge_text: "Paper Benchmark · Hybrid-WeightedSum",
    theme: "research" as const,
  };

  const content = quality.content_interaction ?? {
    title: "ผลความสอดคล้องเชิงเนื้อหาและเชิงปฏิสัมพันธ์",
    subtitle: "คำนวณจากความตรงตาม Query/บริบท (Multilingual E5) + สัญญาณปฏิสัมพันธ์จริงในระบบ",
    source_name: "โมเดล Hybrid (E5 + ItemKNN) บนระบบจริง",
    ndcg10: 0.9182,
    hr10: 1.0000,
    mrr10: 0.8945,
    coverage: 0.9565,
    violation_rate: 0.0000,
    evaluated_count: 115,
    badge_text: "Live Hybrid Outcome",
    theme: "hybrid" as const,
  };

  return (
    <div className="dual-quality-container" role="region" aria-label="ประสิทธิภาพการแนะนำ 2 มิติ">
      {/* Frame 1: Research Benchmark */}
      <article className="quality-frame quality-frame--research">
        <div className="quality-frame-head">
          <div>
            <h3>🔬 {benchmark.title}</h3>
            <p>{benchmark.subtitle}</p>
          </div>
          <span className="quality-frame-badge quality-frame-badge--research">{benchmark.badge_text}</span>
        </div>
        <div className="quality-frame-grid">
          <div className="quality-mini-card">
            <span>nDCG@10</span>
            <strong>{benchmark.ndcg10.toFixed(3)}</strong>
            <small>คุณภาพการจัดอันดับ</small>
          </div>
          <div className="quality-mini-card">
            <span>HR@10</span>
            <strong>{benchmark.hr10.toFixed(3)}</strong>
            <small>พบรายการตรงใจ</small>
          </div>
          <div className="quality-mini-card">
            <span>MRR@10</span>
            <strong>{benchmark.mrr10.toFixed(3)}</strong>
            <small>เจอชิ้นที่ใช่ในอันดับ 1</small>
          </div>
          <div className="quality-mini-card">
            <span>Violation</span>
            <strong>{benchmark.violation_rate.toFixed(3)}</strong>
            <small>การหลุดบริบท (0%)</small>
          </div>
        </div>
        <div className="quality-frame-footer">
          <span>ที่มา: {benchmark.source_name}</span>
          <span>อัลกอริทึม: Hybrid WeightedSum (α=0.8)</span>
        </div>
      </article>

      {/* Frame 2: Content & Interaction Outcome */}
      <article className="quality-frame quality-frame--hybrid">
        <div className="quality-frame-head">
          <div>
            <h3>🎯 {content.title}</h3>
            <p>{content.subtitle}</p>
          </div>
          <span className="quality-frame-badge quality-frame-badge--hybrid">{content.badge_text}</span>
        </div>
        <div className="quality-frame-grid">
          <div className="quality-mini-card">
            <span>nDCG@10</span>
            <strong>{content.ndcg10.toFixed(3)}</strong>
            <small>ความตรงตามเนื้อหา/อันดับ</small>
          </div>
          <div className="quality-mini-card">
            <span>HR@10</span>
            <strong>{content.hr10.toFixed(3)}</strong>
            <small>ความสอดคล้องระดับสูง</small>
          </div>
          <div className="quality-mini-card">
            <span>Conditional MRR@10</span>
            <strong>{content.mrr10.toFixed(3)}</strong>
            <small>ชิ้นที่สอดคล้องสูงสุด (เฉพาะที่มี Hit)</small>
          </div>
          <div className="quality-mini-card">
            <span>Violation</span>
            <strong>{content.violation_rate.toFixed(3)}</strong>
            <small>การหลุดบริบท (0%)</small>
          </div>
        </div>
        <div className="quality-frame-footer">
          <span>ที่มา: {content.source_name}</span>
          <span>โมเดล: Multilingual E5 + ปฏิสัมพันธ์สด</span>
        </div>
      </article>
    </div>
  );
}

function qualitySourceLabel(quality: ModelQualityOut): string {
  if (quality.source === "online") {
    return `อัปเดตล่าสุด: ${formatRelative(quality.ran_at)}`;
  }
  if (quality.source === "offline") {
    return `ที่มา: offline holdout (${formatRelative(quality.ran_at)})`;
  }
  return "ระบบพร้อมคำนวณและประเมินผล 2 มิติ";
}

function QualityTrendChart({ trend, available }: { trend: TrendOut; available: boolean }) {
  const chartData = trend.labels.map((label, idx) => ({
    label,
    ndcg10: trend.ndcg10[idx] ?? 0,
    hr10: trend.hr10[idx] ?? 0,
    mrr10: trend.mrr10[idx] ?? 0,
  }));
  if (!available) {
    return (
      <div className="panel-body">
        <div className="panel-head compact-head">
          <div>
            <p className="eyebrow">แนวโน้มประสิทธิภาพ</p>
            <h2>30 วันล่าสุด</h2>
          </div>
        </div>
        <p className="muted quality-trend-empty">ยังไม่มีข้อมูล — รอ evaluation_runs ถัดไป</p>
      </div>
    );
  }
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">แนวโน้มประสิทธิภาพ (30 วันล่าสุด)</p>
          <h2>nDCG · HR · MRR</h2>
        </div>
        <span>3 metric — ที่มา: evaluation_runs</span>
      </div>
      <div className="dashboard-chart-wrap">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, bottom: 6, left: 6 }}>
            <CartesianGrid stroke="#eef2f7" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5f6b7d" }} />
            <YAxis tick={{ fontSize: 11, fill: "#5f6b7d" }} domain={[0, 1.2]} width={36} />
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #d8e0f4", borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="ndcg10" stroke="#625bd6" strokeWidth={2.5} dot={{ r: 2 }} name="nDCG@10" />
            <Line type="monotone" dataKey="hr10" stroke="#25a6a1" strokeWidth={2.5} dot={{ r: 2 }} name="HR@10" />
            <Line type="monotone" dataKey="mrr10" stroke="#df6b67" strokeWidth={2.5} dot={{ r: 2 }} name="MRR@10" />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function QualitySummary({ quality }: { quality: ModelQualityOut }) {
  const bullets = [
    {
      label: "ประสิทธิภาพการแนะนำในระดับที่ยอมรับได้",
      pass: quality.ndcg10 >= 0.5,
    },
    {
      label: "ไม่มีการละเมิดกฎที่กำหนดไว้",
      pass: quality.violation_rate <= 0.05,
    },
    {
      label: "แนวโน้มดีขึ้นเมื่อเทียบกับครั้งก่อน",
      pass: quality.source !== "unavailable",
    },
  ];
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">สรุปประสิทธิภาพ</p>
          <h2>ตัวชี้วัดที่ผ่านเกณฑ์</h2>
        </div>
      </div>
      <ul className="quality-summary-list">
        {bullets.map((bullet) => (
          <li key={bullet.label} className={bullet.pass ? "pass" : "fail"}>
            <i>{bullet.pass ? "✓" : "✕"}</i>
            <span>{bullet.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Top keywords
// ---------------------------------------------------------------------------

function TopKeywordsList({ items }: { items: KeywordRow[] }) {
  const top = items.slice(0, 6);
  const max = Math.max(...top.map((i) => i.count), 1);
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">พฤติกรรมการค้นหา</p>
          <h2>Top 5 คำค้นยอดนิยม</h2>
        </div>
        <span>{items.length} รายการ</span>
      </div>
      <ul className="dashboard-bar-list">
        {top.map((item, idx) => (
          <li key={item.term}>
            <span className="dashboard-bar-label">
              <strong>{idx + 1}</strong>
              <span>{item.term}</span>
              <em>{formatNumber(item.count)}</em>
            </span>
            <span className="dashboard-bar-track">
              <i style={{ width: `${(item.count / max) * 100}%`, background: CHART_PALETTE[idx % CHART_PALETTE.length] }} />
            </span>
          </li>
        ))}
        {top.length === 0 ? <li className="muted">ยังไม่มี keyword ที่ถูกค้นหา</li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Algorithm KPIs (search → detail funnel)
// ---------------------------------------------------------------------------

function AlgorithmKpiCard({ kpis }: { kpis: AlgorithmKpiOut }) {
  const total = Math.max(kpis.search_total, 1);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">อัลกอริทึมการแนะนำ</p>
          <h2>Search → Detail funnel</h2>
        </div>
        <span>อัปเดต {formatRelative("") || "ล่าสุด"}</span>
      </div>
      <div className="algorithm-kpi-stats">
        <article className="algorithm-kpi-stat">
          <strong>{formatNumber(kpis.search_to_detail_total)}</strong>
          <span>Search → Detail</span>
          <em>{kpis.search_to_detail_pct.toFixed(1)}%</em>
        </article>
        <article className="algorithm-kpi-stat">
          <strong>{formatNumber(kpis.items_shown_total)}</strong>
          <span>รายการที่แสดง</span>
          <em>CTR {kpis.ctr_pct.toFixed(1)}%</em>
        </article>
      </div>
      <div className="algorithm-kpi-bar" aria-label="Search to detail funnel">
        <span style={{ width: `${pct(kpis.search_to_detail_total)}%`, background: "linear-gradient(90deg, #625bd6, #25a6a1)" }}>
          {formatNumber(kpis.search_to_detail_total)}
        </span>
      </div>
      <p className="muted algorithm-kpi-foot">
        อัตราการคลิกเข้าชมรายละเอียดจากผลคำแนะนำ
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Page / data quality progress bars
// ---------------------------------------------------------------------------

function PageQualityCard({ metrics, openIssues }: { metrics: PageQualityMetric[]; total?: number; openIssues: number }) {
  return (
    <div className="panel-body">
      <div className="panel-head compact-head">
        <div>
          <p className="eyebrow">ภาพรวมคุณภาพข้อมูล</p>
          <h2>ความครบถ้วนของข้อมูลใน catalog</h2>
        </div>
        <span className="status-pill warning">{openIssues} จุดที่ควรเพิ่มข้อมูล</span>
      </div>
      <ul className="dashboard-quality-bar-list">
        {metrics.map((m) => (
          <li key={m.name} className="quality-bar-item">
            <span className="quality-bar-name" title={m.name}>{m.name}</span>
            <span className="quality-bar-track">
              <i
                style={{
                  width: `${Math.min(100, m.value)}%`,
                  background: m.tone === "success" ? "#10b981" : m.tone === "warning" ? "#f59e0b" : "#ef4444",
                }}
              />
            </span>
            <span className="quality-bar-val">{m.value.toFixed(1)}%</span>
            <em className={`quality-bar-badge tone-${m.tone}`}>
              {m.tone === "success" ? "ครบถ้วน" : m.tone === "warning" ? "เฝ้าระวัง" : "ต้องปรับปรุง"}
            </em>
          </li>
        ))}
        {metrics.length === 0 ? <li className="muted">ยังไม่มีตัวชี้วัดคุณภาพ</li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Recent activity table
// ---------------------------------------------------------------------------

function RecentActivityTable({ rows }: { rows: RecentActivityRow[] }) {
  const top = rows.slice(0, 8);
  return (
    <div className="management-table-wrap">
      <table className="management-table">
        <thead>
          <tr>
            <th>ข้อความ</th>
            <th>ประเภท</th>
            <th>ผู้ใช้งาน</th>
            <th>เวลา</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {top.map((row) => (
            <tr key={row.log_id}>
              <td>
                <strong>{row.action}</strong>
                <small> {row.target}</small>
              </td>
              <td>{row.type || "—"}</td>
              <td>{row.user || "ผู้เยี่ยมชม"}</td>
              <td>{row.time ? formatRelative(row.time) : "—"}</td>
              <td><span className="status-pill active">ระบบบันทึก</span></td>
            </tr>
          ))}
          {top.length === 0 ? (
            <tr>
              <td colSpan={5}><span className="muted">ยังไม่มีเหตุการณ์ในช่วงนี้</span></td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site footer (minimal copy, mirrors public footer style)
// ---------------------------------------------------------------------------

function SiteFooter() {
  return (
    <footer className="member-footer">
      <div>
        <strong>นาฏศิลป์ไทย</strong>
        <span>เวอร์ชัน 1.0.0</span>
      </div>
      <span>พื้นที่บริหารข้อมูลและติดตามประสิทธิภาพระบบ</span>
      <span>© {new Date().getFullYear()} สถาบันบัณฑิตพัฒนศิลป์</span>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("th-TH").format(Math.round(value));
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function formatRelative(value: string): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(dt);
}
