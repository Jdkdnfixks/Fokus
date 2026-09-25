import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, Download, Sparkles, Table2 } from "lucide-react";
import { Empty, ModuleSelect, ProgressBar, Segmented, toast } from "../../components/ui";
import { call, errorText, isTauri } from "../../lib/tauri";
import { DAY, addDays, fmtDate, fmtDuration, fmtHours, isoWeek, parseLocal, startOfDay, startOfWeek, toDateStr, todayStr } from "../../lib/time";
import { useData } from "../../store/data";
import type { ID, Session } from "../../store/types";
import { BarList, ColumnChart, DotChart, Heatmap, HeatLegend, TipRow, type HeatDay } from "./charts";
import { averageRating, bestFocusWindow, currentStreak, dailyTotals, hourProfile, longestStreak, sessionDate, weekMinutes } from "./stats";

type Range = "7" | "28" | "91" | "all";

const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7 Tage" },
  { value: "28", label: "4 Wochen" },
  { value: "91", label: "3 Monate" },
  { value: "all", label: "Gesamt" },
];

const hoursFmt = (m: number) => fmtHours(m);
const axisHours = (m: number) => `${(m / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`;

export function StatsPage() {
  const sessions = useData((s) => s.data.sessions);
  const modules = useData((s) => s.data.modules);
  const tasks = useData((s) => s.data.tasks);
  const [range, setRange] = useState<Range>("28");
  const [moduleId, setModuleId] = useState<ID | null>(null);

  const moduleById = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules]);

  // Zeitraum
  const today = startOfDay(new Date());
  const firstSession = sessions.reduce<Date | null>((a, s) => {
    const d = new Date(s.start);
    return !a || d < a ? d : a;
  }, null);
  const days = range === "all" ? Math.max(7, Math.ceil((today.getTime() - startOfDay(firstSession ?? today).getTime()) / DAY) + 1) : Number(range);
  const from = addDays(today, -(days - 1));
  const to = addDays(today, 1);
  const prevFrom = addDays(from, -days);

  const inRange = (s: Session, a: Date, b: Date) => {
    const t = new Date(s.start).getTime();
    return t >= a.getTime() && t < b.getTime() && (moduleId === null || s.moduleId === moduleId);
  };
  const scoped = useMemo(() => sessions.filter((s) => inRange(s, from, to)), [sessions, range, moduleId, from.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const previous = sessions.filter((s) => inRange(s, prevFrom, from));

  const total = scoped.reduce((a, s) => a + s.focusMinutes, 0);
  const prevTotal = previous.reduce((a, s) => a + s.focusMinutes, 0);
  const completed = scoped.filter((s) => s.completed).length;
  const studyDays = new Set(scoped.map(sessionDate)).size;
  const avgRating = averageRating(scoped);
  const moduleSessions = moduleId ? sessions.filter((s) => s.moduleId === moduleId) : sessions;
  const streak = currentStreak(moduleSessions);
  const longest = longestStreak(moduleSessions);

  if (!sessions.length) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Statistik</h1>
        </div>
        <div className="card">
          <Empty
            icon={<BarChart3 size={20} />}
            title="Noch keine Lerneinheiten"
            text="Sobald du mit dem Timer lernst, siehst du hier deine Lernzeiten, Serien, Wochenziele und deine besten Tageszeiten."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page stats-page">
      <div className="page-header">
        <div>
          <h1>Statistik</h1>
          <p className="subtitle">Wie viel, wann und woran du lernst</p>
        </div>
      </div>

      <div className="grid stats-top">
        <YearHeatmap sessions={moduleSessions} />
        <WeeklyGoals />
      </div>

      <div className="filter-row">
        <Segmented<Range> value={range} onChange={setRange} options={RANGES} />
        <ModuleSelect value={moduleId} onChange={setModuleId} noneLabel="Alle Module" className="select sm filter-select" />
        <span className="grow" />
        <button className="btn sm" onClick={() => void exportCsv(scoped, moduleById, tasks)}>
          <Download size={14} /> CSV exportieren
        </button>
      </div>

      <div className="grid cols-4 kpi-row">
        <Kpi
          label="Lernzeit"
          value={fmtHours(total)}
          delta={range === "all" ? null : total - prevTotal}
          deltaLabel="ggü. Vorzeitraum"
        />
        <Kpi label="Pomodoros" value={String(completed)} sub={`an ${studyDays} ${studyDays === 1 ? "Tag" : "Tagen"}`} />
        <Kpi label="Serie" value={`${streak} ${streak === 1 ? "Tag" : "Tage"}`} sub={`Rekord: ${longest} ${longest === 1 ? "Tag" : "Tage"}`} />
        <Kpi
          label="Ø Konzentration"
          value={avgRating ? avgRating.toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "–"}
          sub={avgRating ? "von 5 (aus deinen Reflexionen)" : "noch keine Bewertungen"}
        />
      </div>

      <div className="grid cols-2 mt-16">
        <TimeChart sessions={scoped} from={from} days={days} />
        <ModuleChart sessions={scoped} total={total} />
      </div>
      <div className="grid cols-2 mt-16">
        <HourCharts sessions={scoped} />
        <ReflectionLog sessions={scoped} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, delta, deltaLabel }: { label: string; value: string; sub?: string; delta?: number | null; deltaLabel?: string }) {
  return (
    <div className="card tight">
      <div className="stat">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
        {delta !== undefined && delta !== null ? (
          <span className={`stat-sub row gap-4 ${delta >= 0 ? "delta-up" : "delta-down"}`}>
            {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {delta >= 0 ? "+" : "−"}
            {fmtHours(Math.abs(delta))} {deltaLabel}
          </span>
        ) : (
          sub && <span className="stat-sub">{sub}</span>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, hint, children, table }: { title: string; hint?: ReactNode; children: ReactNode; table: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="card chart-card">
      <div className="card-header">
        <div className="col" style={{ gap: 0 }}>
          <h3>{title}</h3>
          {hint && <span className="tiny faint">{hint}</span>}
        </div>
        <button className={`icon-btn sm ${showTable ? "active" : ""}`} onClick={() => setShowTable(!showTable)} title={showTable ? "Diagramm" : "Als Tabelle"}>
          {showTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
        </button>
      </div>
      {showTable ? <div className="chart-table">{table}</div> : children}
    </div>
  );
}

/* ---------------- Heatmap ---------------- */

function YearHeatmap({ sessions }: { sessions: Session[] }) {
  const totals = useMemo(() => dailyTotals(sessions), [sessions]);
  const WEEKS = 26;
  const start = addDays(startOfWeek(new Date()), -(WEEKS - 1) * 7);
  const todayS = todayStr();
  const weeks: HeatDay[][] = [];
  const monthLabels: { index: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const week: HeatDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const ds = toDateStr(date);
      const v = totals.get(ds) ?? 0;
      week.push({
        date: ds,
        value: v,
        inFuture: ds > todayS,
        tip: <TipRow label={fmtDate(ds, { weekday: "short", day: "numeric", month: "long" })} value={v ? fmtDuration(v) : "nichts"} />,
      });
    }
    const m = addDays(start, w * 7).getMonth();
    if (m !== lastMonth) {
      const prev = monthLabels[monthLabels.length - 1];
      if (w < WEEKS - 2 && (!prev || w - prev.index >= 3))
        monthLabels.push({ index: w, label: addDays(start, w * 7).toLocaleDateString("de-DE", { month: "short" }) });
      lastMonth = m;
    }
    weeks.push(week);
  }
  const activeDays = [...totals.entries()].filter(([d, v]) => v > 0 && d >= toDateStr(start)).length;

  return (
    <div className="card">
      <div className="card-header">
        <div className="col" style={{ gap: 0 }}>
          <h3>Lerntage im letzten halben Jahr</h3>
          <span className="tiny faint">{activeDays} Tage mit Lernzeit · jedes Kästchen ist ein Tag</span>
        </div>
        <HeatLegend />
      </div>
      <Heatmap weeks={weeks} monthLabels={monthLabels} />
    </div>
  );
}

/* ---------------- Wochenziele ---------------- */

function WeeklyGoals() {
  const allModules = useData((s) => s.data.modules);
  const modules = allModules.filter((m) => !m.archived && m.weeklyGoalMinutes > 0);
  const sessions = useData((s) => s.data.sessions);
  const now = new Date();
  return (
    <div className="card">
      <div className="card-header">
        <div className="col" style={{ gap: 0 }}>
          <h3>Wochenziele</h3>
          <span className="tiny faint">KW {isoWeek(now)} · seit Montag</span>
        </div>
      </div>
      {modules.length ? (
        <div className="col gap-12">
          {modules.map((m) => {
            const done = weekMinutes(sessions, now, m.id);
            const pct = done / m.weeklyGoalMinutes;
            return (
              <div key={m.id} className="col gap-4">
                <div className="row between small">
                  <span className="row gap-4 ellipsis">
                    <span className="dot" style={{ background: m.color }} />
                    <span className="ellipsis">{m.short || m.name}</span>
                  </span>
                  <span className="muted tabular nowrap">
                    {fmtHours(done)} / {fmtHours(m.weeklyGoalMinutes)}
                    {pct >= 1 && " ✓"}
                  </span>
                </div>
                <ProgressBar value={pct} color={m.color} />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="small faint">Lege bei deinen Modulen ein Wochenziel fest, um deinen Fortschritt hier zu sehen.</p>
      )}
    </div>
  );
}

/* ---------------- Lernzeit im Verlauf ---------------- */

function TimeChart({ sessions, from, days }: { sessions: Session[]; from: Date; days: number }) {
  const totals = useMemo(() => dailyTotals(sessions), [sessions]);
  const daily = days <= 31;
  const data = useMemo(() => {
    if (daily) {
      return Array.from({ length: days }, (_, i) => {
        const d = addDays(from, i);
        const ds = toDateStr(d);
        const v = totals.get(ds) ?? 0;
        const label = d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
        const tick = days <= 7 ? d.toLocaleDateString("de-DE", { weekday: "short" }) : d.getDay() === 1 ? `${d.getDate()}.${d.getMonth() + 1}.` : "";
        return { key: ds, label, tick, value: v, tip: <TipRow label={label} value={fmtDuration(v)} /> };
      });
    }
    // wöchentlich
    const out = [];
    let w = startOfWeek(from);
    const end = new Date();
    while (w <= end) {
      let v = 0;
      for (let i = 0; i < 7; i++) v += totals.get(toDateStr(addDays(w, i))) ?? 0;
      const kw = isoWeek(w);
      const label = `KW ${kw} (ab ${w.toLocaleDateString("de-DE", { day: "numeric", month: "short" })})`;
      out.push({ key: toDateStr(w), label, tick: "", value: v, tip: <TipRow label={label} value={fmtDuration(v)} /> });
      w = addDays(w, 7);
    }
    const every = Math.ceil(out.length / 8);
    return out.map((d, i) => ({ ...d, tick: i % every === 0 ? `KW ${isoWeek(parseLocal(d.key))}` : "" }));
  }, [totals, from.getTime(), days, daily]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ChartCard
      title={daily ? "Lernzeit pro Tag" : "Lernzeit pro Woche"}
      hint="Höchster Wert ist beschriftet – für Details über die Säulen fahren"
      table={
        <table className="table">
          <thead>
            <tr>
              <th>{daily ? "Tag" : "Woche"}</th>
              <th style={{ textAlign: "right" }}>Lernzeit</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="tabular" style={{ textAlign: "right" }}>
                  {fmtDuration(d.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ColumnChart data={data} format={axisHours} unit={60} />
    </ChartCard>
  );
}

/* ---------------- Nach Modul ---------------- */

function ModuleChart({ sessions, total }: { sessions: Session[]; total: number }) {
  const modules = useData((s) => s.data.modules);
  const rows = useMemo(() => {
    const map = new Map<string, { minutes: number; count: number }>();
    for (const s of sessions) {
      const key = s.moduleId ?? "none";
      const cur = map.get(key) ?? { minutes: 0, count: 0 };
      cur.minutes += s.focusMinutes;
      cur.count += s.completed ? 1 : 0;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([key, v]) => {
        const m = modules.find((x) => x.id === key);
        return { key, label: m?.name ?? "Ohne Modul", short: m?.short || m?.name || "Ohne Modul", color: m?.color ?? "#8a8f88", ...v };
      })
      .sort((a, b) => b.minutes - a.minutes);
  }, [sessions, modules]);

  return (
    <ChartCard
      title="Lernzeit nach Modul"
      hint="im gewählten Zeitraum"
      table={
        <table className="table">
          <thead>
            <tr>
              <th>Modul</th>
              <th style={{ textAlign: "right" }}>Lernzeit</th>
              <th style={{ textAlign: "right" }}>Anteil</th>
              <th style={{ textAlign: "right" }}>Pomodoros</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <span className="row gap-4">
                    <span className="dot" style={{ background: r.color }} />
                    {r.label}
                  </span>
                </td>
                <td className="tabular" style={{ textAlign: "right" }}>
                  {fmtHours(r.minutes)}
                </td>
                <td className="tabular" style={{ textAlign: "right" }}>
                  {total ? Math.round((r.minutes / total) * 100) : 0} %
                </td>
                <td className="tabular" style={{ textAlign: "right" }}>
                  {r.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {rows.length ? (
        <BarList
          data={rows.map((r) => ({
            key: r.key,
            label: r.short,
            color: r.color,
            value: r.minutes,
            tip: (
              <>
                <TipRow color={r.color} label={r.label} value={fmtDuration(r.minutes)} />
                <div className="tip-sub">
                  {total ? Math.round((r.minutes / total) * 100) : 0} % · {r.count} Pomodoros
                </div>
              </>
            ),
          }))}
          format={hoursFmt}
        />
      ) : (
        <p className="small faint">Keine Lernzeit in diesem Zeitraum.</p>
      )}
    </ChartCard>
  );
}

/* ---------------- Tageszeit ---------------- */

function HourCharts({ sessions }: { sessions: Session[] }) {
  const profile = useMemo(() => hourProfile(sessions), [sessions]);
  const best = bestFocusWindow(sessions);
  const used = profile.filter((b) => b.minutes > 0).map((b) => b.hour);
  const fromH = Math.min(7, ...(used.length ? used : [7]));
  const toH = Math.max(22, ...(used.length ? used : [22]));
  const hours = profile.filter((b) => b.hour >= fromH && b.hour <= toH);
  const tick = (h: number) => (h % 3 === 0 ? `${h}` : "");

  return (
    <ChartCard
      title="Wann du lernst"
      hint="Lernzeit und Konzentration nach Startzeit der Einheit"
      table={
        <table className="table">
          <thead>
            <tr>
              <th>Uhrzeit</th>
              <th style={{ textAlign: "right" }}>Lernzeit</th>
              <th style={{ textAlign: "right" }}>Ø Konzentration</th>
            </tr>
          </thead>
          <tbody>
            {hours
              .filter((b) => b.minutes > 0)
              .map((b) => (
                <tr key={b.hour}>
                  <td>
                    {b.hour}–{b.hour + 1} Uhr
                  </td>
                  <td className="tabular" style={{ textAlign: "right" }}>
                    {fmtDuration(b.minutes)}
                  </td>
                  <td className="tabular" style={{ textAlign: "right" }}>
                    {b.ratingCount ? (b.ratingSum / b.ratingCount).toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "–"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      }
    >
      {best && (
        <div className="insight">
          <Sparkles size={15} />
          <span>
            Am konzentriertesten bist du zwischen <strong>{best.from} und {best.to} Uhr</strong> (Ø{" "}
            {best.avg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} von 5). Plane dort deine schwierigsten Themen.
          </span>
        </div>
      )}
      <span className="tiny faint">Lernzeit</span>
      <ColumnChart
        height={150}
        format={axisHours}
        unit={60}
        data={hours.map((b) => ({
          key: String(b.hour),
          label: `${b.hour} Uhr`,
          tick: tick(b.hour),
          value: b.minutes,
          tip: <TipRow label={`${b.hour}–${b.hour + 1} Uhr`} value={fmtDuration(b.minutes)} />,
        }))}
      />
      <span className="tiny faint mt-8" style={{ display: "block" }}>
        Ø Konzentration (1–5)
      </span>
      <DotChart
        min={1}
        max={5}
        format={(v) => String(v)}
        data={hours.map((b) => ({
          key: String(b.hour),
          tick: tick(b.hour),
          value: b.ratingCount ? b.ratingSum / b.ratingCount : null,
          tip: (
            <TipRow
              label={`${b.hour}–${b.hour + 1} Uhr · ${b.ratingCount} Bewertungen`}
              value={b.ratingCount ? (b.ratingSum / b.ratingCount).toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "–"}
            />
          ),
        }))}
      />
    </ChartCard>
  );
}

/* ---------------- Reflexionen ---------------- */

function ReflectionLog({ sessions }: { sessions: Session[] }) {
  const modules = useData((s) => s.data.modules);
  const withNotes = sessions
    .filter((s) => s.note || s.rating)
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 12);
  return (
    <div className="card">
      <div className="card-header">
        <div className="col" style={{ gap: 0 }}>
          <h3>Deine Reflexionen</h3>
          <span className="tiny faint">Was du nach deinen Lernphasen notiert hast</span>
        </div>
      </div>
      {withNotes.length ? (
        <div className="col gap-4 reflection-list">
          {withNotes.map((s) => {
            const m = modules.find((x) => x.id === s.moduleId);
            return (
              <div key={s.id} className="reflection-item">
                <div className="row between">
                  <span className="row gap-4 tiny muted">
                    {m && <span className="dot" style={{ background: m.color }} />}
                    {m?.short || m?.name || "Ohne Modul"} · {new Date(s.start).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })},{" "}
                    {new Date(s.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {s.rating && (
                    <span className="rating-dots" title={`Konzentration ${s.rating} von 5`}>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <span key={i} className={i <= s.rating! ? "on" : ""} />
                      ))}
                    </span>
                  )}
                </div>
                {s.note && <p className="small">{s.note}</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="small faint">Noch keine Reflexionen in diesem Zeitraum.</p>
      )}
    </div>
  );
}

/* ---------------- CSV-Export ---------------- */

async function exportCsv(sessions: Session[], modules: Map<string, { name: string }>, tasks: { id: string; title: string }[]) {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["Datum", "Beginn", "Ende", "Modul", "Aufgabe", "Minuten", "Vollständig", "Konzentration", "Notiz"];
  const rows = [...sessions]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s) => {
      const start = new Date(s.start);
      const end = new Date(s.end);
      return [
        start.toLocaleDateString("de-DE"),
        start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        end.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        (s.moduleId && modules.get(s.moduleId)?.name) || "",
        (s.taskId && tasks.find((t) => t.id === s.taskId)?.title) || "",
        s.focusMinutes.toLocaleString("de-DE"),
        s.completed ? "ja" : "nein",
        s.rating ? String(s.rating) : "",
        s.note ?? "",
      ].map(esc);
    });
  const csv = "﻿" + [header, ...rows].map((r) => r.join(";")).join("\r\n");
  const name = `fokus-lernzeiten-${todayStr()}.csv`;
  try {
    if (isTauri) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      await call("write_text_file", { path, content: csv });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = name;
      a.click();
    }
    toast(`${rows.length} Lerneinheiten exportiert.`, "success");
  } catch (e) {
    toast(`Export fehlgeschlagen: ${errorText(e)}`, "error");
  }
}
