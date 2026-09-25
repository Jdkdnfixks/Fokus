import { useEffect, useRef, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------
 * Schlichte SVG-Diagramme: dünne Balken (max. 24 px) mit abgerundetem
 * Ende, Haarlinien-Raster, sparsame Direktbeschriftung und Tooltip beim
 * Überfahren. Texte nutzen immer Textfarben, nie die Datenfarbe.
 * ------------------------------------------------------------------ */

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ---------------- Tooltip ---------------- */

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const show = (e: React.PointerEvent | React.FocusEvent, content: ReactNode) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    let x: number;
    let y: number;
    if ("clientX" in e) {
      x = e.clientX - box.left;
      y = e.clientY - box.top;
    } else {
      const r = (e.target as Element).getBoundingClientRect();
      x = r.left + r.width / 2 - box.left;
      y = r.top - box.top;
    }
    setTip({ x, y, content });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div
      className="chart-tip"
      style={{
        left: Math.min(Math.max(tip.x, 70), (wrapRef.current?.clientWidth ?? 0) - 70),
        top: tip.y,
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { wrapRef, show, hide, node };
}

export function TipRow({ color, label, value }: { color?: string; label: ReactNode; value: ReactNode }) {
  return (
    <div className="tip-row">
      {color && <span className="tip-key" style={{ background: color }} />}
      <span className="tip-value">{value}</span>
      <span className="tip-label">{label}</span>
    </div>
  );
}

/** Rundet eine Achse auf „schöne“ Werte */
export function niceMax(v: number, ticks = 4): { max: number; step: number } {
  if (v <= 0) return { max: 1, step: 0.25 };
  const raw = v / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(v / step) * step, step };
}

/** Säule mit 4 px abgerundetem Kopf und gerader Basis */
function columnPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Balken nach rechts, gerade Basis links, runder Kopf rechts */
function barPath(x: number, y: number, w: number, h: number) {
  if (w <= 0) return "";
  const r = Math.min(4, h / 2, w);
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

/* ---------------- Säulendiagramm (eine Reihe) ---------------- */

export interface ColumnDatum {
  key: string;
  label: string;
  /** kurze Achsenbeschriftung (leer = keine) */
  tick: string;
  value: number;
  tip: ReactNode;
}

export function ColumnChart({
  data,
  height = 180,
  color = "var(--accent)",
  format,
  highlightLast = false,
  unit = 1,
}: {
  data: ColumnDatum[];
  height?: number;
  color?: string;
  format: (v: number) => string;
  highlightLast?: boolean;
  /** Achsenschritte in dieser Einheit runden (z. B. 60 = volle Stunden) */
  unit?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const left = 40;
  const bottom = 22;
  const top = 18;
  const plotW = Math.max(0, width - left - 4);
  const plotH = height - bottom - top;
  const maxV = Math.max(0, ...data.map((d) => d.value));
  const nice = niceMax(maxV / unit);
  const max = nice.max * unit;
  const step = nice.step * unit;
  const slot = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, slot - 2 - slot * 0.3));
  const maxIdx = data.findIndex((d) => d.value === maxV && maxV > 0);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);

  return (
    <div ref={tip.wrapRef} className="chart-wrap">
      <div ref={ref} style={{ width: "100%" }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Säulendiagramm">
            {ticks.map((v) => {
              const y = top + plotH - (v / max) * plotH;
              return (
                <g key={v}>
                  <line x1={left} x2={width - 4} y1={y} y2={y} className="grid-line" />
                  <text x={left - 8} y={y + 4} className="axis-text" textAnchor="end">
                    {format(v)}
                  </text>
                </g>
              );
            })}
            {data.map((d, i) => {
              const h = max ? (d.value / max) * plotH : 0;
              const x = left + i * slot + (slot - barW) / 2;
              const y = top + plotH - h;
              const emphasize = highlightLast ? i === data.length - 1 : true;
              return (
                <g key={d.key}>
                  {/* großzügige Trefferfläche über die ganze Spalte */}
                  <rect
                    x={left + i * slot}
                    y={top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.label}: ${format(d.value)}`}
                    onPointerMove={(e) => tip.show(e, d.tip)}
                    onPointerLeave={tip.hide}
                    onFocus={(e) => tip.show(e, d.tip)}
                    onBlur={tip.hide}
                    className="hit"
                  />
                  <path d={columnPath(x, y, barW, h)} fill={color} opacity={emphasize ? 1 : 0.55} className="mark" pointerEvents="none" />
                  {i === maxIdx && h > 0 && (
                    <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="value-text">
                      {format(d.value)}
                    </text>
                  )}
                  {d.tick && (
                    <text x={left + i * slot + slot / 2} y={height - 6} textAnchor="middle" className="axis-text">
                      {d.tick}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={left} x2={width - 4} y1={top + plotH} y2={top + plotH} className="axis-line" />
          </svg>
        )}
      </div>
      {tip.node}
    </div>
  );
}

/* ---------------- Horizontale Balken (je Modul) ---------------- */

export interface BarDatum {
  key: string;
  label: string;
  color: string;
  value: number;
  tip: ReactNode;
}

export function BarList({ data, format }: { data: BarDatum[]; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const labelW = Math.min(180, Math.max(100, width * 0.3));
  const valueW = 56;
  const rowH = 30;
  const barH = 14;
  const max = Math.max(0, ...data.map((d) => d.value));
  const plotW = Math.max(0, width - labelW - valueW);
  const height = data.length * rowH;

  return (
    <div ref={tip.wrapRef} className="chart-wrap">
      <div ref={ref} style={{ width: "100%" }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Balkendiagramm">
            {data.map((d, i) => {
              const y = i * rowH;
              const w = max ? (d.value / max) * plotW : 0;
              return (
                <g key={d.key}>
                  <rect
                    x={0}
                    y={y}
                    width={width}
                    height={rowH}
                    fill="transparent"
                    className="hit"
                    tabIndex={0}
                    aria-label={`${d.label}: ${format(d.value)}`}
                    onPointerMove={(e) => tip.show(e, d.tip)}
                    onPointerLeave={tip.hide}
                    onFocus={(e) => tip.show(e, d.tip)}
                    onBlur={tip.hide}
                  />
                  <circle cx={6} cy={y + rowH / 2} r={4.5} fill={d.color} pointerEvents="none" />
                  <text x={18} y={y + rowH / 2 + 4} className="label-text" pointerEvents="none">
                    {truncate(d.label, Math.floor((labelW - 24) / 7))}
                  </text>
                  <line x1={labelW} x2={labelW} y1={y + 6} y2={y + rowH - 6} className="axis-line" />
                  <path d={barPath(labelW, y + (rowH - barH) / 2, w, barH)} fill={d.color} className="mark" pointerEvents="none" />
                  <text x={labelW + w + 8} y={y + rowH / 2 + 4} className="value-text" pointerEvents="none">
                    {format(d.value)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {tip.node}
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
}

/* ---------------- Punktdiagramm (Konzentration je Stunde) ---------------- */

export interface DotDatum {
  key: string;
  tick: string;
  value: number | null;
  tip: ReactNode;
}

export function DotChart({ data, min, max, height = 120, format }: { data: DotDatum[]; min: number; max: number; height?: number; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const left = 40;
  const bottom = 22;
  const top = 10;
  const plotW = Math.max(0, width - left - 4);
  const plotH = height - bottom - top;
  const slot = data.length ? plotW / data.length : 0;
  const yOf = (v: number) => top + plotH - ((v - min) / (max - min)) * plotH;
  const ticks = [min, (min + max) / 2, max];

  return (
    <div ref={tip.wrapRef} className="chart-wrap">
      <div ref={ref} style={{ width: "100%" }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Punktdiagramm">
            {ticks.map((v) => (
              <g key={v}>
                <line x1={left} x2={width - 4} y1={yOf(v)} y2={yOf(v)} className="grid-line" />
                <text x={left - 8} y={yOf(v) + 4} textAnchor="end" className="axis-text">
                  {format(v)}
                </text>
              </g>
            ))}
            {segments(data).map((seg, si) =>
              seg.length > 1 ? (
                <polyline
                  key={si}
                  points={seg.map((i) => `${left + i * slot + slot / 2},${yOf(data[i].value!)}`).join(" ")}
                  fill="none"
                  stroke="var(--accent)"
                  strokeOpacity={0.35}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null,
            )}
            {data.map((d, i) => {
              const x = left + i * slot + slot / 2;
              return (
                <g key={d.key}>
                  <rect
                    x={left + i * slot}
                    y={top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    className="hit"
                    tabIndex={d.value === null ? -1 : 0}
                    onPointerMove={(e) => tip.show(e, d.tip)}
                    onPointerLeave={tip.hide}
                    onFocus={(e) => tip.show(e, d.tip)}
                    onBlur={tip.hide}
                  />
                  {d.value !== null && (
                    <circle cx={x} cy={yOf(d.value)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} pointerEvents="none" className="mark" />
                  )}
                  {d.tick && (
                    <text x={x} y={height - 6} textAnchor="middle" className="axis-text">
                      {d.tick}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {tip.node}
    </div>
  );
}

/** Zusammenhängende Abschnitte ohne Lücken (Indizes) */
function segments(data: DotDatum[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  data.forEach((d, i) => {
    if (d.value === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) out.push(cur);
  return out;
}

/* ---------------- Kalender-Heatmap ---------------- */

export interface HeatDay {
  date: string;
  value: number;
  inFuture: boolean;
  tip: ReactNode;
}

export function Heatmap({ weeks, monthLabels }: { weeks: HeatDay[][]; monthLabels: { index: number; label: string }[] }) {
  const tip = useTip();
  const cell = 13;
  const gap = 3;
  const left = 26;
  const top = 18;
  const max = Math.max(0, ...weeks.flat().map((d) => d.value));
  const level = (v: number) => (v <= 0 ? 0 : max <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const width = left + weeks.length * (cell + gap);
  const height = top + 7 * (cell + gap);

  return (
    <div ref={tip.wrapRef} className="chart-wrap heatmap-wrap">
      <svg width={width} height={height} role="img" aria-label="Lernzeit pro Tag">
        {monthLabels.map((m) => (
          <text key={m.index} x={left + m.index * (cell + gap)} y={11} className="axis-text">
            {m.label}
          </text>
        ))}
        {["Mo", "", "Mi", "", "Fr", "", ""].map((d, i) =>
          d ? (
            <text key={i} x={0} y={top + i * (cell + gap) + cell - 2} className="axis-text">
              {d}
            </text>
          ) : null,
        )}
        {weeks.map((week, wi) =>
          week.map((day, di) =>
            day.inFuture ? null : (
              <rect
                key={day.date}
                x={left + wi * (cell + gap)}
                y={top + di * (cell + gap)}
                width={cell}
                height={cell}
                rx={3}
                className={`heat-cell l${level(day.value)}`}
                tabIndex={0}
                aria-label={day.date}
                onPointerMove={(e) => tip.show(e, day.tip)}
                onPointerLeave={tip.hide}
                onFocus={(e) => tip.show(e, day.tip)}
                onBlur={tip.hide}
              />
            ),
          ),
        )}
      </svg>
      {tip.node}
    </div>
  );
}

export function HeatLegend() {
  return (
    <span className="row gap-4 tiny faint">
      weniger
      {[0, 1, 2, 3, 4].map((l) => (
        <svg key={l} width={12} height={12}>
          <rect width={12} height={12} rx={3} className={`heat-cell l${l}`} />
        </svg>
      ))}
      mehr
    </span>
  );
}
