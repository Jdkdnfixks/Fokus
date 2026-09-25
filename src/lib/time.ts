import type { DateStr, LocalDateTime } from "../store/types";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
/** Wochentage in der Reihenfolge Mo … So */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const pad = (n: number) => String(n).padStart(2, "0");

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toLocalDT(d: Date): LocalDateTime {
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Liest "YYYY-MM-DD" oder "YYYY-MM-DDTHH:mm" als lokale Zeit. */
export function parseLocal(s: string): Date {
  const [datePart, timePart] = s.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  if (!timePart) return new Date(y, m - 1, d);
  const [hh, mm] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

export function todayStr(): DateStr {
  return toDateStr(new Date());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MINUTE);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Montag der Woche (00:00) */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const diff = (s.getDay() + 6) % 7;
  return addDays(s, -diff);
}

export function sameDay(a: Date, b: Date): boolean {
  return toDateStr(a) === toDateStr(b);
}

/** Ganze Kalendertage von a bis b (b − a) */
export function daysBetween(a: DateStr, b: DateStr): number {
  const da = parseLocal(a);
  const db = parseLocal(b);
  return Math.round((startOfDay(db).getTime() - startOfDay(da).getTime()) / DAY);
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}

export function withTime(date: DateStr, time: string): LocalDateTime {
  return `${date}T${time}`;
}

/** 95 → "1 Std 35 Min" */
export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} Min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} Std ${rest} Min` : `${h} Std`;
}

/** 95 → "1,6 h" */
export function fmtHours(minutes: number, digits = 1): string {
  return `${(minutes / 60).toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: 0 })} h`;
}

/** Millisekunden → "mm:ss" (aufgerundet) */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad(m)}:${pad(s)}`;
}

export function fmtDate(d: Date | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }): string {
  const date = typeof d === "string" ? parseLocal(d) : d;
  return date.toLocaleDateString("de-DE", opts);
}

export function fmtTime(d: Date | string): string {
  const date = typeof d === "string" ? (d.includes("Z") || d.length > 16 ? new Date(d) : parseLocal(d)) : d;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "heute", "morgen", "in 5 Tagen", "vor 2 Tagen" */
export function relativeDays(target: DateStr, from: DateStr = todayStr()): string {
  const n = daysBetween(from, target);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === -1) return "gestern";
  if (n > 0) return `in ${n} Tagen`;
  return `vor ${-n} Tagen`;
}

/** ISO-Kalenderwoche */
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / DAY + 1) / 7);
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Hallo";
  if (h < 22) return "Guten Abend";
  return "Gute Nacht";
}
