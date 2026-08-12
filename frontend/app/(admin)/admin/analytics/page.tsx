"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { ApiClientError, getAnalytics } from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import type {
  ActionBreakdownRow,
  AnalyticsOut,
  AudienceSegment,
  FunnelStep,
  InsightCard,
  KeywordPairRow,
} from "@/lib/types";

type AnalyticsTab = "trends" | "behavior" | "ai";
type Range = "7d" | "30d" | "90d" | "365d";

const RANGE_OPTIONS: ReadonlyArray<{ value: Range; label: string }> = [
  { value: "7d", label: "7 วันที่ผ่านมา" },
  { value: "30d", label: "30 วันที่ผ่านมา" },
  { value: "90d", label: "90 วันที่ผ่านมา" },
  { value: "365d", label: "365 วันที่ผ่านมา" },
];

const TAB_OPTIONS: ReadonlyArray<{ value: AnalyticsTab; label: string; description: string }> = [
  { value: "trends", label: "วิเคราะห์แนวโน้ม", description: "การใช้งานและคุณภาพระบบ" },
  { value: "behavior", label: "พฤติกรรมผู้ใช้งาน", description: "Funnel และรูปแบบความสนใจ" },
  { value: "ai", label: "ข้อมูลเชิงลึก AI", description: "ข้อสรุปพร้อมหลักฐาน" },
];

const COLORS = ["#625bd6", "#25a6a1", "#df6b67", "#4c91d1", "#9b62cf"];

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<AnalyticsOut | null>(null);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("trends");
  const [range, setRange] = useState<Range>("30d");
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.replace("/login?next=/admin/analytics");
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
    setLoading(true);
    setError(null);
    getAnalytics(range)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof ApiClientError
            ? `${reason.code}: ${reason.message}`
            : reason instanceof Error
              ? reason.message
              : String(reason),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, ready, reloadKey]);

  if (!ready) return <div className="panel">กำลังตรวจสอบสิทธิ์...</div>;

  return (
    <div className="analytics-page dashboard-page--phase3">
      <section className="dashboard-hero analytics-hero">
        <div>
          <p className="eyebrow">Advanced Analytics Workspace</p>
          <h1>วิเคราะห์ข้อมูลและพฤติกรรมเชิงลึก</h1>
          <p>
            เปลี่ยนข้อมูลการใช้งานเป็นแนวโน้ม Funnel และข้อเสนอแนะที่ตรวจสอบย้อนกลับได้
          </p>
        </div>
        <div className="dashboard-actions">
          <label className="dashboard-range-select">
            <select value={range} onChange={(event) => setRange(event.target.value as Range)} aria-label="เลือกช่วงเวลา">
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <Link className="secondary" href="/admin">กลับ Dashboard</Link>
          <button type="button" className="primary" disabled={loading} onClick={() => setReloadKey((value) => value + 1)}>
            {loading ? "กำลังโหลด..." : "รีเฟรชข้อมูล"}
          </button>
        </div>
      </section>

      <nav className="admin-mode-tabs" aria-label="เมนูผู้ดูแลระบบ">
        <Link href="/admin">สถิติการใช้งาน</Link>
        <Link className="active" href="/admin/analytics">วิเคราะห์ข้อมูล</Link>
        <Link href="/admin/items">บริหารจัดการฐานข้อมูล</Link>
      </nav>

      <nav className="analytics-tabs" role="tablist" aria-label="ประเภทการวิเคราะห์">
        {TAB_OPTIONS.map((tab, index) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            className={activeTab === tab.value ? "active" : undefined}
            onClick={() => setActiveTab(tab.value)}
          >
            <span>{index + 1}</span>
            <strong>{tab.label}</strong>
            <small>{tab.description}</small>
          </button>
        ))}
      </nav>

      {error ? (
        <div className="error-panel analytics-error" role="alert">
          <strong>โหลดข้อมูลวิเคราะห์ไม่สำเร็จ</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setReloadKey((value) => value + 1)}>ลองใหม่</button>
        </div>
      ) : null}

      {!data && !error ? <div className="panel">กำลังประมวลผลข้อมูลรวม...</div> : null}

      {data ? (
        <>
          <div className="analytics-meta">
            <span className={`status-pill ${data.source === "postgres" ? "active" : "muted"}`}>
              {data.source === "postgres" ? "ข้อมูลจริงจาก Postgres" : "ฐานข้อมูลไม่พร้อม"}
            </span>
            <span>ช่วง {data.range_days} วัน</span>
            <span>อัปเดต {formatDate(data.generated_at)}</span>
          </div>
          {activeTab === "trends" ? <TrendsTab data={data} /> : null}
          {activeTab === "behavior" ? <BehaviorTab data={data} /> : null}
          {activeTab === "ai" ? <AIInsightsTab data={data} /> : null}
        </>
      ) : null}
    </div>
  );
}

function TrendsTab({ data }: { data: AnalyticsOut }) {
  const analysis = useMemo(() => buildTrendAnalysis(data), [data]);

  return (
    <div className="analytics-tab-panel" role="tabpanel">
      <section className="trend-purpose-banner">
        <span>↗</span>
        <div>
          <strong>มองการเปลี่ยนแปลง ไม่ใช่แสดงตัวเลขซ้ำ</strong>
          <p>เปรียบเทียบครึ่งหลังกับครึ่งแรกของช่วง {data.range_days} วัน เพื่อชี้ทิศทาง ความผิดปกติ และสิ่งที่ควรดำเนินการ</p>
        </div>
      </section>

      <AnalyticsSection title="Momentum เทียบช่วงก่อน" subtitle="ครึ่งหลังของช่วงเวลาที่เลือก เทียบกับครึ่งแรก">
        <div className="trend-momentum-grid">
          {analysis.metrics.map((metric, index) => (
            <article key={metric.key} className={`trend-momentum-card trend-${metric.status}`} style={{ "--analytics-accent": COLORS[index] } as React.CSSProperties}>
              <div className="trend-momentum-head">
                <span>{metric.label}</span>
                <em>{metric.statusLabel}</em>
              </div>
              <strong>{formatNumber(metric.current)}</strong>
              <div className="trend-comparison-values">
                <span>ช่วงก่อน <b>{formatNumber(metric.previous)}</b></span>
                <span className={metric.delta == null ? "neutral" : metric.delta >= 0 ? "up" : "down"}>
                  {formatDelta(metric.delta)}
                </span>
              </div>
              <div className="trend-comparison-track"><i style={{ width: `${metric.progress}%` }} /></div>
            </article>
          ))}
        </div>
      </AnalyticsSection>

      <div className="trend-analysis-grid">
        <AnalyticsSection title="สัญญาณที่ตรวจพบ" subtitle="แปลตัวเลขเป็นประเด็นสำหรับตัดสินใจ">
          <div className="trend-signal-list">
            {analysis.signals.map((signal) => (
              <article key={signal.title} className={`trend-signal trend-${signal.tone}`}>
                <span>{signal.tone === "positive" ? "↑" : signal.tone === "warning" ? "!" : "→"}</span>
                <div><strong>{signal.title}</strong><p>{signal.detail}</p></div>
              </article>
            ))}
          </div>
        </AnalyticsSection>

        <AnalyticsSection title="สุขภาพของแนวโน้ม" subtitle="ความต่อเนื่อง จุดสูงสุด และ Conversion">
          <div className="trend-diagnostic-grid">
            {analysis.diagnostics.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        </AnalyticsSection>
      </div>

      <AnalyticsSection title="ตารางเปรียบเทียบเชิงวิเคราะห์" subtitle="ใช้ตรวจสอบที่มาของสถานะเติบโต ทรงตัว หรือชะลอตัว">
        <article className="research-panel analytics-table-card">
          <div className="management-table-wrap">
            <table className="management-table trend-comparison-table">
              <thead><tr><th>ตัวชี้วัด</th><th>ช่วงก่อน</th><th>ช่วงล่าสุด</th><th>เปลี่ยนแปลง</th><th>สถานะ</th></tr></thead>
              <tbody>
                {analysis.metrics.map((metric) => (
                  <tr key={metric.key}>
                    <td><strong>{metric.label}</strong></td>
                    <td>{formatNumber(metric.previous)}</td>
                    <td>{formatNumber(metric.current)}</td>
                    <td className={metric.delta == null ? "neutral" : metric.delta >= 0 ? "up" : "down"}>{formatDelta(metric.delta)}</td>
                    <td><span className={`trend-status-pill trend-${metric.status}`}>{metric.statusLabel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </AnalyticsSection>
    </div>
  );
}

function BehaviorTab({ data }: { data: AnalyticsOut }) {
  const behavior = data.behavior;
  return (
    <div className="analytics-tab-panel" role="tabpanel">
      <AnalyticsSection title="Recommendation Funnel" subtitle="นับตาม request เดียวกันจากค้นหาไปถึงการมีส่วนร่วม">
        <div className="analytics-funnel">
          {behavior.funnel.map((step, index) => <FunnelCard key={step.key} step={step} index={index} />)}
        </div>
      </AnalyticsSection>

      <AnalyticsSection title="กลุ่มพฤติกรรมผู้ใช้" subtitle="แสดงเฉพาะจำนวนรวม ไม่เปิดเผยชื่อหรือรหัสผู้ใช้">
        <div className="analytics-segment-grid">
          {behavior.audience_segments.map((segment, index) => <SegmentCard key={segment.key} segment={segment} index={index} />)}
        </div>
      </AnalyticsSection>

      <div className="analytics-two-col">
        <AnalyticsSection title="กิจกรรมที่เกิดขึ้น" subtitle="สัดส่วน Interaction ในช่วงที่เลือก">
          <article className="research-panel analytics-list-card">
            <ActionBars rows={behavior.actions} />
          </article>
        </AnalyticsSection>
        <AnalyticsSection title="Keyword ที่มักเลือกพร้อมกัน" subtitle="คู่คำจาก Recommendation request เดียวกัน">
          <article className="research-panel analytics-table-card">
            <KeywordPairsTable rows={behavior.keyword_pairs} />
          </article>
        </AnalyticsSection>
      </div>
    </div>
  );
}

function AIInsightsTab({ data }: { data: AnalyticsOut }) {
  const insights = data.ai_insights;
  return (
    <div className="analytics-tab-panel" role="tabpanel">
      <section className="analytics-ai-banner">
        <div>
          <span className="analytics-ai-icon">AI</span>
          <div>
            <strong>สรุปจากข้อมูลรวม พร้อมหลักฐานตรวจสอบได้</strong>
            <p>{insights.privacy_notice}</p>
          </div>
        </div>
        <div className="analytics-ai-meta">
          <span className="status-pill active">{insights.engine === "gemini" ? "Gemini-assisted" : "Evidence rules"}</span>
          <span>{insights.cached ? "ผลจาก cache" : "ประมวลผลใหม่"}</span>
          <span>TTL {Math.round(insights.cache_ttl_seconds / 60)} นาที</span>
        </div>
      </section>

      <div className="analytics-insight-grid">
        {insights.items.map((insight) => <InsightArticle key={insight.id} insight={insight} />)}
      </div>
      {insights.items.length === 0 ? <div className="panel">ยังไม่มีข้อมูลมากพอสำหรับสร้างข้อสรุป</div> : null}
    </div>
  );
}

function AnalyticsSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="analytics-section">
      <div className="analytics-section-head">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
      </div>
      {children}
    </section>
  );
}

function FunnelCard({ step, index }: { step: FunnelStep; index: number }) {
  return (
    <article className="analytics-funnel-step" style={{ "--analytics-accent": COLORS[index % COLORS.length] } as React.CSSProperties}>
      <span className="analytics-step-number">{index + 1}</span>
      <strong>{formatNumber(step.count)}</strong>
      <h3>{step.label}</h3>
      <div className="analytics-progress"><i style={{ width: `${Math.min(100, step.conversion_from_start)}%` }} /></div>
      <small>{index === 0 ? "จุดเริ่มต้น 100%" : `${step.rate_from_previous.toFixed(1)}% จากขั้นก่อนหน้า`}</small>
    </article>
  );
}

function SegmentCard({ segment, index }: { segment: AudienceSegment; index: number }) {
  return (
    <article className="analytics-segment-card">
      <i style={{ background: COLORS[index % COLORS.length] }} />
      <span>{segment.label}</span>
      <strong>{formatNumber(segment.count)}</strong>
      <em>{segment.pct.toFixed(1)}%</em>
      <small>{segment.definition}</small>
    </article>
  );
}

function ActionBars({ rows }: { rows: ActionBreakdownRow[] }) {
  return <RankedBars rows={rows.map((row) => ({ label: row.label, value: row.count, suffix: `${row.pct.toFixed(1)}%` }))} />;
}

function RankedBars({ rows }: { rows: Array<{ label: string; value: number; suffix?: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  if (rows.length === 0) return <p className="muted">ยังไม่มีข้อมูลในช่วงเวลานี้</p>;
  return (
    <ul className="analytics-ranked-bars">
      {rows.map((row, index) => (
        <li key={`${row.label}-${index}`}>
          <span><strong>{row.label}</strong><em>{formatNumber(row.value)}{row.suffix ? ` · ${row.suffix}` : ""}</em></span>
          <div><i style={{ width: `${(row.value / max) * 100}%`, background: COLORS[index % COLORS.length] }} /></div>
        </li>
      ))}
    </ul>
  );
}

function KeywordPairsTable({ rows }: { rows: KeywordPairRow[] }) {
  return (
    <div className="management-table-wrap">
      <table className="management-table">
        <thead><tr><th>อันดับ</th><th>คู่ Keyword</th><th>ครั้ง</th></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.left}-${row.right}`}>
              <td>{index + 1}</td>
              <td><strong>{row.left}</strong><span className="analytics-pair-join">+</span><strong>{row.right}</strong></td>
              <td>{formatNumber(row.count)}</td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={3}>ยังไม่มี request ที่เลือก Keyword ตั้งแต่ 2 คำขึ้นไป</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function InsightArticle({ insight }: { insight: InsightCard }) {
  const confidence = Math.round(insight.confidence * 100);
  return (
    <article className={`analytics-insight-card tone-${insight.tone}`}>
      <div className="analytics-insight-head">
        <span>{insight.id === "traffic" ? "↗" : insight.id === "funnel" ? "⇢" : insight.id === "demand" ? "⌕" : "✓"}</span>
        <div><h2>{insight.title}</h2><p>{insight.summary}</p></div>
      </div>
      <div className="analytics-confidence">
        <span>ความเชื่อมั่น</span><strong>{confidence}%</strong>
        <div><i style={{ width: `${confidence}%` }} /></div>
      </div>
      <div className="analytics-evidence">
        <strong>หลักฐาน</strong>
        <ul>{insight.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
      <div className="analytics-recommendation">
        <strong>ข้อเสนอแนะ</strong><p>{insight.recommendation}</p>
      </div>
    </article>
  );
}

type TrendStatus = "growth" | "stable" | "decline";

interface TrendMetricAnalysis {
  key: string;
  label: string;
  previous: number;
  current: number;
  delta: number | null;
  progress: number;
  status: TrendStatus;
  statusLabel: string;
}

interface TrendSignal {
  title: string;
  detail: string;
  tone: "positive" | "warning" | "neutral";
}

function buildTrendAnalysis(data: AnalyticsOut) {
  const trends = data.trends;
  const series = [
    { key: "sessions", label: "Sessions", labels: trends.trend_30d.labels, values: trends.trend_30d.sessions },
    { key: "searches", label: "Searches", labels: trends.trend_30d.labels, values: trends.trend_30d.searches },
    { key: "ratings", label: "Ratings", labels: trends.trend_30d.labels, values: trends.trend_30d.ratings },
    { key: "new_users", label: "ผู้ใช้ใหม่", labels: trends.user_growth.labels, values: trends.user_growth.new_users },
  ];
  const rawMetrics = series.map((item) => {
    const { previous, current } = comparePeriods(item.labels, item.values, data.generated_at, data.range_days);
    const delta = previous > 0 ? ((current - previous) / previous) * 100 : null;
    const status: TrendStatus = delta == null || Math.abs(delta) < 10 ? "stable" : delta > 0 ? "growth" : "decline";
    return {
      ...item,
      previous,
      current,
      delta,
      status,
      statusLabel: status === "growth" ? "เติบโต" : status === "decline" ? "ชะลอตัว" : "ทรงตัว",
    };
  });
  const maxValue = Math.max(...rawMetrics.flatMap((item) => [item.previous, item.current]), 1);
  const metrics: TrendMetricAnalysis[] = rawMetrics.map(({ labels: _labels, values: _values, ...item }) => ({
    ...item,
    progress: Math.max(4, Math.min(100, (item.current / maxValue) * 100)),
  }));

  const activityTotals = trends.trend_30d.labels.map((label, index) => ({
    label,
    value: (trends.trend_30d.sessions[index] ?? 0) + (trends.trend_30d.searches[index] ?? 0) + (trends.trend_30d.ratings[index] ?? 0),
  }));
  const peak = activityTotals.reduce((best, row) => row.value > best.value ? row : best, { label: "—", value: 0 });
  const activeDays = activityTotals.filter((row) => row.value > 0).length;
  const activeDayRate = data.range_days > 0 ? (activeDays / data.range_days) * 100 : 0;
  const strongest = metrics
    .filter((item) => item.delta != null)
    .sort((left, right) => Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0))[0];

  const signals: TrendSignal[] = [];
  if (strongest) {
    signals.push({
      title: `${strongest.label} เป็นตัวแปรที่เปลี่ยนชัดที่สุด`,
      detail: `ช่วงล่าสุด ${formatDelta(strongest.delta)} เมื่อเทียบกับช่วงก่อน จัดอยู่ในสถานะ “${strongest.statusLabel}”`,
      tone: strongest.status === "growth" ? "positive" : strongest.status === "decline" ? "warning" : "neutral",
    });
  } else {
    signals.push({ title: "ยังไม่มีฐานเปรียบเทียบเพียงพอ", detail: "ควรเก็บข้อมูลต่อเนื่องอีกอย่างน้อยหนึ่งช่วงก่อนสรุปทิศทาง", tone: "neutral" });
  }
  const detailRate = trends.algorithm_kpis.search_to_detail_pct;
  signals.push(detailRate < 20
    ? { title: "Search → Detail เป็นคอขวด", detail: `Conversion ปัจจุบัน ${detailRate.toFixed(1)}% ควรตรวจอันดับผลลัพธ์ ภาพ และคำอธิบายชุดการแสดง`, tone: "warning" }
    : { title: "Search → Detail อยู่ในระดับติดตามต่อได้", detail: `Conversion ปัจจุบัน ${detailRate.toFixed(1)}% ควรเปรียบเทียบกับช่วงถัดไปเพื่อยืนยันแนวโน้ม`, tone: "positive" });
  signals.push(activeDayRate < 50
    ? { title: "การใช้งานยังกระจุกตัวเป็นบางวัน", detail: `พบกิจกรรม ${activeDays} จาก ${data.range_days} วัน (${activeDayRate.toFixed(1)}%) ควรวางแผนกระตุ้นการกลับมาใช้งาน`, tone: "warning" }
    : { title: "การใช้งานมีความต่อเนื่อง", detail: `พบกิจกรรม ${activeDays} จาก ${data.range_days} วัน (${activeDayRate.toFixed(1)}%)`, tone: "positive" });

  return {
    metrics,
    signals,
    diagnostics: [
      { label: "วันที่กิจกรรมสูงสุด", value: peak.label, detail: `${formatNumber(peak.value)} เหตุการณ์รวม` },
      { label: "วันที่มีการใช้งาน", value: `${activeDayRate.toFixed(1)}%`, detail: `${activeDays} จาก ${data.range_days} วัน` },
      { label: "Engagement rate", value: `${data.behavior.engagement_rate.toFixed(1)}%`, detail: `${formatNumber(data.behavior.engaged_users)} ผู้ใช้มีส่วนร่วม` },
      { label: "Search → Detail", value: `${detailRate.toFixed(1)}%`, detail: detailRate < 20 ? "เป็นจุดที่ควรปรับปรุง" : "อยู่ในระดับติดตามต่อ" },
    ],
  };
}

function comparePeriods(labels: string[], values: number[], generatedAt: string, rangeDays: number): { previous: number; current: number } {
  const end = new Date(generatedAt);
  const midpoint = new Date(end.getTime() - (rangeDays / 2) * 24 * 60 * 60 * 1000);
  if (Number.isNaN(midpoint.getTime())) return compareArrayHalves(values);
  return labels.reduce((result, label, index) => {
    const date = new Date(`${label}T00:00:00`);
    if (Number.isNaN(date.getTime())) return result;
    if (date >= midpoint) result.current += values[index] ?? 0;
    else result.previous += values[index] ?? 0;
    return result;
  }, { previous: 0, current: 0 });
}

function compareArrayHalves(values: number[]): { previous: number; current: number } {
  if (values.length <= 1) return { previous: 0, current: values.reduce((sum, value) => sum + value, 0) };
  const midpoint = Math.floor(values.length / 2);
  return {
    previous: values.slice(0, midpoint).reduce((sum, value) => sum + value, 0),
    current: values.slice(midpoint).reduce((sum, value) => sum + value, 0),
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDelta(value: number | null): string {
  if (value == null) return "ยังไม่มีฐานเทียบ";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
