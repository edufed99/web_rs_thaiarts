"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import {
  ApiClientError,
  getBaseUrl,
  getContexts,
  getItems,
  getKeywords,
  getMetrics,
  getModelConfig,
  getRequestTrend,
} from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import type {
  ContextOut,
  ItemOut,
  KeywordOut,
  MetricsOut,
  ModelConfigOut,
  RequestTrendOut,
} from "@/lib/types";

interface DashboardState {
  metrics: MetricsOut;
  contexts: ContextOut[];
  keywords: KeywordOut[];
  items: ItemOut[];
  totalItems: number;
  trend: RequestTrendOut;
  config: ModelConfigOut;
}

const MONTH_LABELS = ["ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค."];
// FALLBACK_PLACEHOLDER_*: removed; chart now reads from real backend data via
// /metrics/requests. If the DB is disabled the chart renders zeros and
// shows an inline "no data" hint.

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.replace("/login?next=/dashboard");
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

    Promise.all([
      getMetrics(),
      getContexts(),
      getKeywords(undefined, 1000),
      getItems({ limit: 12 }),
      getRequestTrend(12),
      getModelConfig(),
    ])
      .then(([metrics, contextList, keywordList, itemList, trend, config]) => {
        if (cancelled) return;
        setState({
          metrics,
          contexts: contextList.contexts,
          keywords: keywordList.keywords,
          items: itemList.items,
          totalItems: itemList.total,
          trend,
          config,
        });
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
  }, [ready, reloadKey]);

  // Derived state — computed below the loading guards, so it's safe to
  // assert ``state`` is non-null by the time we reach here.
  const modelControls = useMemo(() => {
    // Map the active config into the slider UI. We render real values
    // (from /metrics/config) as percentages so the dashboard reflects the
    // pipeline's actual choice, not a hardcoded placeholder.
    const cfg = state?.config;
    const fallback = {
      cbf_model: "",
      cf_model: "ItemKNN",
      hybrid_alpha: 0.7,
      itemknn_k: 10,
      itemknn_shrink: 50.0,
    };
    const c = cfg ?? fallback;
    const alpha = c.hybrid_alpha ?? fallback.hybrid_alpha;
    const cbfPct = Math.round(alpha * 100);
    const cfPct = 100 - cbfPct;
    const k = c.itemknn_k ?? fallback.itemknn_k;
    const kPct = Math.min(100, Math.round((k / 50) * 100));
    return [
      {
        label: "CBF weight",
        value: cbfPct,
        detail: `${c.cbf_model || "encoder"} · α=${alpha.toFixed(2)}`,
      },
      {
        label: "CF weight",
        value: cfPct,
        detail: `${c.cf_model || "ItemKNN"} · 1-α=${(1 - alpha).toFixed(2)}`,
      },
      {
        label: "ItemKNN K",
        value: kPct,
        detail: `top-K=${k} neighbour · shrink=${c.itemknn_shrink ?? fallback.itemknn_shrink}`,
      },
    ];
  }, [state?.config]);

  if (!ready) {
    return <div className="panel">กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (error) {
    return (
      <section className="dashboard-page">
        <div className="error-panel" role="alert">
          <strong>โหลด dashboard ไม่สำเร็จ</strong>
          <span>{errorCode ? `${errorCode}: ` : ""}{error}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
            ลองใหม่
          </button>
        </div>
      </section>
    );
  }

  if (!state) {
    return <div className="panel">กำลังโหลด dashboard...</div>;
  }

  const { metrics, contexts, keywords, items, totalItems, trend, config } = state;
  const activeContextCount = contexts.filter((context) => context.active_item_count > 0).length;
  const topContexts = [...contexts]
    .sort((a, b) => b.active_item_count - a.active_item_count)
    .slice(0, 6);
  const catalogRows = items.slice(0, 8);
  const validationAlerts = [
    {
      value: contexts.filter((context) => context.active_item_count === 0).length,
      label: "บริบทที่ยังไม่มีรายการ",
      detail: "ควรตรวจความครอบคลุมก่อนเปิดใช้กับผู้ใช้จริง",
      tone: "warning",
    },
    {
      value: items.filter((item) => item.keywords.length === 0).length,
      label: "รายการไม่มี keyword",
      detail: "กระทบ CBF และคำอธิบายเชิง XAI",
      tone: "danger",
    },
    {
      value: items.filter((item) => item.contexts.length === 0).length,
      label: "รายการไม่มี context",
      detail: "context gate อาจตัดออกจากผลลัพธ์",
      tone: "neutral",
    },
  ];
  const methodLabel = config.hybrid_method || "Hybrid-WeightedSum";
  const buildDate = formatDate(metrics.artifacts_loaded_at);
  const apiDocsHref = `${getBaseUrl()}/docs`;
  const trendSourceNote = trend.source === "postgres"
    ? `ข้อมูลจาก Postgres (${trend.months} เดือนล่าสุด)`
    : "ข้อมูลจาก Postgres ไม่พร้อมใช้งาน — แสดง 0 ทุกช่วงเวลา";
  const trendHasData = trend.total_requests > 0 || trend.total_shown > 0;
  const trendLabels = trendHasData
    ? trend.buckets.map((bucket) => bucket.label)
    : MONTH_LABELS;
  const trendRequests = trendHasData
    ? trend.buckets.map((bucket) => bucket.request_count)
    : trend.buckets.map(() => 0);
  const trendShown = trendHasData
    ? trend.buckets.map((bucket) => bucket.shown_count)
    : trend.buckets.map(() => 0);
  // Catalog Coverage Watchlist — surfaces items that are likely to score low
  // because they're missing keywords/contexts (CBF cold-start) or carry no
  // description (poor XAI explanation). Sourced from the live /items payload
  // so the table is honest about what the loader sees right now.
  const watchlistRows = useMemo(() => {
    const rows: { item: ItemOut; issue: string; status: string; tone: string; action: string }[] = [];
    for (const item of items) {
      if (item.keywords.length === 0) {
        rows.push({
          item,
          issue: "ไม่มี keyword",
          status: "CBF cold-start",
          tone: "danger",
          action: "เพิ่ม keyword ผ่าน /admin/items",
        });
      } else if (item.contexts.length === 0) {
        rows.push({
          item,
          issue: "ไม่มี context",
          status: "อาจถูก context gate ตัด",
          tone: "warning",
          action: "เพิ่ม context ใน /admin/items",
        });
      } else if (!item.description || item.description.trim().length === 0) {
        rows.push({
          item,
          issue: "ไม่มีคำอธิบาย",
          status: "explanation จะว่าง",
          tone: "neutral",
          action: "เพิ่มคำอธิบายใน /admin/items",
        });
      }
      if (rows.length >= 8) break;
    }
    return rows;
  }, [items]);

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero researcher-hero">
        <div>
          <p className="eyebrow">Researcher / Admin Dashboard</p>
          <h1>ศูนย์บริหารข้อมูลและติดตามประสิทธิภาพ AI</h1>
          <p>
            รวมภาพรวม catalog, keyword taxonomy, context coverage, model state และเครื่องมือสำหรับงานวิจัย recommender system
          </p>
        </div>
        <div className="dashboard-actions">
          <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            รีเฟรชข้อมูล
          </button>
          <Link className="secondary" href="/admin/items">จัดการ catalog</Link>
          <Link className="primary" href="/admin/items/new">เพิ่มชุดการแสดง</Link>
        </div>
      </section>

      <nav className="admin-mode-tabs" aria-label="เมนูผู้ดูแลระบบ">
        <Link className="active" href="/dashboard">Dashboard / สถิติการใช้งาน</Link>
        <Link href="/admin/items">บริหารจัดการฐานข้อมูล</Link>
      </nav>

      <nav className="dashboard-stage" aria-label="Research dashboard sections">
        <a href="#overview-metrics">Overview Metrics</a>
        <a href="#data-management">Knowledge Base</a>
        <a href="#ai-automation">AI / V&amp;V Control</a>
        <a href="#feedback-users">Feedback &amp; Users</a>
      </nav>

      <section id="overview-metrics" className="dashboard-section">
        <div className="research-section-head">
          <div>
            <p className="eyebrow">1. Overview Metrics</p>
            <h2>แผงสรุปตัวเลขและประสิทธิภาพของระบบ</h2>
          </div>
          <span>Artifact build {buildDate} · config {shortHash(metrics.config_hash)}</span>
        </div>

        <div className="dashboard-kpi-grid" aria-label="ตัวชี้วัดภาพรวม">
          <KpiCard label="Catalog items" value={formatNumber(totalItems || metrics.item_count)} hint={`${items.length} รายการล่าสุดที่โหลดในหน้านี้`} />
          <KpiCard label="Context coverage" value={`${activeContextCount}/${metrics.context_count}`} hint="บริบทที่มีรายการพร้อมแนะนำ" />
          <KpiCard label="Keyword taxonomy" value={formatNumber(metrics.keyword_count || keywords.length)} hint={`${keywords.length} keyword ที่ frontend โหลดได้`} />
          <KpiCard label="Positive signals" value={formatNumber(metrics.unique_item_user_edges)} hint={`${metrics.positive_user_count} users ใน CF artifact`} />
        </div>

        <div className="dashboard-two-col">
          <article className="research-panel dashboard-chart-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Recommendation Trend</p>
                <h2>แนวโน้มคำขอและรายการที่ถูกแนะนำ</h2>
              </div>
              <span>{trendSourceNote}</span>
            </div>
            <TrendChart
              requestValues={trendRequests}
              shownValues={trendShown}
              labels={trendLabels}
            />
            <div className="chart-legend">
              <span><i className="legend-primary" /> คำขอคำแนะนำ ({formatNumber(trend.total_requests)})</span>
              <span><i className="legend-secondary" /> รายการที่ถูกแสดง ({formatNumber(trend.total_shown)})</span>
              {trendHasData ? (
                <strong>ที่มา: recommendation_requests + recommendation_results</strong>
              ) : (
                <strong>ยังไม่มีข้อมูล request — รอให้ผู้ใช้ใช้งาน /recommendations</strong>
              )}
            </div>
          </article>

          <article className="research-panel">
            <div className="panel-head compact-head">
              <div>
                <p className="eyebrow">Top Context Coverage</p>
                <h2>บริบทที่มีชุดการแสดงมากที่สุด</h2>
              </div>
            </div>
            <div className="rank-list">
              {topContexts.map((context, index) => (
                <div className="rank-row" key={context.id}>
                  <strong>{index + 1}</strong>
                  <span>{context.name}</span>
                  <em>{context.active_item_count} รายการ · {context.group || "ไม่ระบุกลุ่ม"}</em>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section id="data-management" className="dashboard-section">
        <div className="research-section-head">
          <div>
            <p className="eyebrow">2. Data &amp; Knowledge Base Management</p>
            <h2>การจัดการคลังข้อมูลชุดการแสดง</h2>
          </div>
          <span>{formatNumber(metrics.item_count)} รายการ · {formatNumber(metrics.keyword_count)} keyword</span>
        </div>

        <div className="admin-tool-grid">
          <Link href="/admin/items/new">
            <strong>เพิ่มชุดการแสดง</strong>
            <span>กรอกคำอธิบาย บริบท และให้ระบบเสนอ keyword ก่อน commit</span>
          </Link>
          <Link href="/admin/items">
            <strong>แก้ไข / ค้นหา catalog</strong>
            <span>ตรวจรายการล่าสุด เปิดดูรายละเอียด และจัดการ taxonomy tags</span>
          </Link>
          <Link href="/items">
            <strong>ตรวจหน้า catalog ผู้ใช้</strong>
            <span>ดูผลลัพธ์จริงจากมุมมองผู้ใช้ก่อนเผยแพร่</span>
          </Link>
          <Link href="/recommend">
            <strong>ทดสอบ recommendation</strong>
            <span>เลือกบริบทและ keyword เพื่อดู ranking และ explanation</span>
          </Link>
        </div>

        <div className="dashboard-two-col">
          <article className="research-panel">
            <div className="panel-head compact-head">
              <h2>ตารางจัดการชุดการแสดง</h2>
              <span>{catalogRows.length} รายการล่าสุดจาก catalog API</span>
            </div>
            <div className="management-table-wrap">
              <table className="management-table">
                <thead>
                  <tr>
                    <th>ชุดการแสดง</th>
                    <th>ประเภท</th>
                    <th>บริบท</th>
                    <th>Keyword</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {catalogRows.map((item) => (
                    <tr key={item.id}>
                      <td><Link href={`/items/${item.id}`}>{item.name}</Link></td>
                      <td>{item.performance_type || item.category_group || "-"}</td>
                      <td>{item.contexts.length}</td>
                      <td>{item.keywords.length}</td>
                      <td><span className="status-pill active">{item.suitability_label || "Active"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="research-panel">
            <div className="panel-head compact-head">
              <h2>Rule Validation</h2>
              <span>จุดที่ควรตรวจก่อนนำไปใช้กับโมเดล</span>
            </div>
            <div className="validation-list">
              {validationAlerts.map((alert) => (
                <div className={`validation-item ${alert.tone}`} key={alert.label}>
                  <strong>{alert.value}</strong>
                  <span>{alert.label}</span>
                  <small>{alert.detail}</small>
                </div>
              ))}
            </div>
            <div className="batch-actions">
              <span>Catalog management</span>
              <Link href="/admin/items">เปิดหน้าจัดการ catalog</Link>
              <Link href={apiDocsHref}>API docs</Link>
            </div>
          </article>
        </div>
      </section>

      <section id="ai-automation" className="dashboard-section">
        <div className="research-section-head">
          <div>
            <p className="eyebrow">3. AI &amp; V&amp;V Automation Control</p>
            <h2>ระบบติดตามและจัดการการประมวลผล AI</h2>
          </div>
          <span>Context Gate · CBF · ItemKNN · {methodLabel}</span>
        </div>

        <div className="dashboard-three-col">
          <article className="research-panel">
            <div className="panel-head compact-head">
              <h2>Model Parameter Tuning</h2>
              <span>ค่าควบคุมสำหรับรอบทดลอง</span>
            </div>
            <div className="model-control-list">
              {modelControls.map((control) => (
                <label key={control.label}>
                  <span>{control.label}</span>
                  <input type="range" min="0" max="100" value={control.value} readOnly />
                  <small>{control.value}% · {control.detail}</small>
                </label>
              ))}
            </div>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.8rem" }}>
              ค่าจาก <code>/metrics/config</code> · {config.candidate_strategy || "EligibilityGate"}
              {config.cbf_keyword_boost != null && ` · keyword boost ${config.cbf_keyword_boost}`}
              {config.positive_threshold != null && ` · positive ≥ ${config.positive_threshold}`}
            </p>
          </article>

          <article className="research-panel">
            <div className="panel-head compact-head">
              <h2>Artifact Status</h2>
              <span>ข้อมูลจาก `/metrics`</span>
            </div>
            <div className="log-list">
              <div>
                <strong>Embedding dimension</strong>
                <span>{metrics.embedding_dim || "ไม่พบค่า embedding"}</span>
                <small>ใช้ตรวจความพร้อมของ CBF vector search</small>
              </div>
              <div>
                <strong>Config hash</strong>
                <span>{shortHash(metrics.config_hash)}</span>
                <small>ใช้เทียบ build ของ pipeline และ artifact</small>
              </div>
              <div>
                <strong>Loaded at</strong>
                <span>{buildDate}</span>
                <small>เวลาโหลด artifact ล่าสุดจาก backend</small>
              </div>
            </div>
          </article>

          <article className="research-panel sandbox-panel">
            <div className="panel-head compact-head">
              <h2>Live Model Testing Sandbox</h2>
              <span>ทดลองจาก dashboard</span>
            </div>
            <form action="/recommend">
              <label htmlFor="sandbox-context">บริบทย่อย</label>
              <select id="sandbox-context" name="context">
                {topContexts.map((context) => (
                  <option key={context.id} value={context.id}>{context.name}</option>
                ))}
              </select>
              <label htmlFor="sandbox-keyword">keyword ทดลอง</label>
              <input id="sandbox-keyword" type="search" name="q" placeholder="เช่น งานมงคล โขน วัฒนธรรม" />
              <button type="submit">รันทดสอบโมเดล</button>
            </form>
          </article>
        </div>

        <article className="research-panel">
          <div className="panel-head compact-head">
            <h2>Catalog Coverage Watchlist</h2>
            <span>ตรวจจาก catalog ที่โหลดในหน้านี้ — รายการที่อาจกระทบคุณภาพคำแนะนำ</span>
          </div>
          <div className="management-table-wrap">
            <table className="management-table">
              <thead>
                <tr>
                  <th>ชุดการแสดง</th>
                  <th>สิ่งที่ตรวจ</th>
                  <th>สถานะปัจจุบัน</th>
                  <th>การใช้งาน</th>
                </tr>
              </thead>
              <tbody>
                {watchlistRows.map((row) => (
                  <tr key={`${row.item.id}-${row.issue}`}>
                    <td><Link href={`/items/${row.item.id}`}>{row.item.name}</Link></td>
                    <td>{row.issue}</td>
                    <td><span className={`status-pill ${row.tone}`}>{row.status}</span></td>
                    <td>{row.action}</td>
                  </tr>
                ))}
                {watchlistRows.length === 0 ? (
                  <tr>
                    <td colSpan={4}><span className="muted">ทุกรายการที่โหลดผ่านเงื่อนไขครบ</span></td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section id="feedback-users" className="dashboard-section">
        <div className="research-section-head">
          <div>
            <p className="eyebrow">4. Feedback Analytics &amp; User Management</p>
            <h2>ศูนย์รวมข้อมูลป้อนกลับและการจัดการสิทธิ์</h2>
          </div>
          <span>live actions · user role · research consent</span>
        </div>

        <div className="dashboard-two-col">
          <article className="research-panel">
            <div className="panel-head compact-head">
              <h2>User Feedback Analytics</h2>
              <span>สรุปจากสัญญาณใน artifact ปัจจุบัน</span>
            </div>
            <div className="feedback-summary">
              <div>
                <strong>{formatNumber(metrics.positive_user_count)}</strong>
                <span>ผู้ใช้ที่มีสัญญาณเชิงบวก</span>
              </div>
              <div>
                <strong>{formatNumber(metrics.unique_item_user_edges)}</strong>
                <span>item-user edges</span>
              </div>
              <div>
                <strong>{metrics.embedding_dim || "-"}</strong>
                <span>embedding dim</span>
              </div>
            </div>
            <div className="log-list">
              {items.slice(0, 4).map((item) => (
                <div key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.suitability_label || "พร้อมใช้ในระบบแนะนำ"}</span>
                  <small>{item.contexts.length} context · {item.keywords.length} keyword</small>
                </div>
              ))}
            </div>
          </article>

          <article className="research-panel">
            <div className="panel-head compact-head">
              <h2>User &amp; Role Management</h2>
              <span>General User · Researcher · Admin</span>
            </div>
            <div className="role-management-panel">
              <div>
                <strong>Admin protected</strong>
                <span>หน้านี้ตรวจ JWT และ `is_admin` ก่อนเข้าใช้งาน</span>
              </div>
              <div>
                <strong>Bootstrap admin</strong>
                <span>ผู้ใช้แรกหรือชื่อใน allow-list จะเป็น admin ตาม backend config</span>
              </div>
              <div>
                <strong>Next action</strong>
                <span>เพิ่ม endpoint สำหรับอ่าน user rows และ interaction logs หากต้องการ dashboard เชิงสถิติเต็มรูปแบบ</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="dashboard-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function TrendChart({
  requestValues,
  shownValues,
  labels,
}: {
  requestValues: number[];
  shownValues: number[];
  labels: string[];
}) {
  const width = 720;
  const height = 280;
  const chartLeft = 38;
  const chartRight = 686;
  const chartTop = 26;
  const chartBottom = 230;
  const maxValue = Math.max(...requestValues, ...shownValues, 1);
  const xFor = (index: number) =>
    chartLeft + (index * (chartRight - chartLeft)) / Math.max(requestValues.length - 1, 1);
  const yFor = (value: number) => chartBottom - (value / maxValue) * (chartBottom - chartTop);
  const pathFor = (values: number[]) =>
    values.map((value, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${yFor(value).toFixed(1)}`).join(" ");
  const fillPath = `${pathFor(requestValues)} L ${chartRight} ${chartBottom} L ${chartLeft} ${chartBottom} Z`;
  const gridLines = [26, 77, 128, 179, 230];

  return (
    <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="กราฟแนวโน้มคำขอคำแนะนำรายเดือน">
      {gridLines.map((line) => (
        <line key={line} className="chart-grid" x1="36" y1={line} x2="684" y2={line} />
      ))}
      <path className="chart-area" d={fillPath} />
      <path className="chart-line secondary-line" d={pathFor(shownValues)} />
      <path className="chart-line primary-line" d={pathFor(requestValues)} />
      {requestValues.map((value, index) => (
        <React.Fragment key={labels[index] ?? index}>
          <circle className="chart-dot" cx={xFor(index)} cy={yFor(value)} r="4" />
          <text className="chart-label" x={xFor(index)} y="258" textAnchor="middle">{labels[index]}</text>
        </React.Fragment>
      ))}
    </svg>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("th-TH").format(value);
}

function formatDate(value: string): string {
  if (!value) return "ยังไม่พบเวลาโหลด";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function shortHash(value: string): string {
  if (!value) return "n/a";
  return value.length > 10 ? value.slice(0, 10) : value;
}
