import { addDays, startOfDay, startOfWeek, toDateStr } from "../../lib/time";
import type { DateStr, ID, Session } from "../../store/types";

export function sessionDate(s: Session): DateStr {
  return toDateStr(new Date(s.start));
}

export function minutesBetween(sessions: Session[], from: Date, to: Date, moduleId?: ID | null): number {
  const a = from.getTime();
  const b = to.getTime();
  let sum = 0;
  for (const s of sessions) {
    const t = new Date(s.start).getTime();
    if (t >= a && t < b && (moduleId === undefined || s.moduleId === moduleId)) sum += s.focusMinutes;
  }
  return sum;
}

export function todayMinutes(sessions: Session[], now = new Date()): number {
  const start = startOfDay(now);
  return minutesBetween(sessions, start, addDays(start, 1));
}

export function weekMinutes(sessions: Session[], now = new Date(), moduleId?: ID | null): number {
  const start = startOfWeek(now);
  return minutesBetween(sessions, start, addDays(start, 7), moduleId);
}

/** Lernminuten pro Tag */
export function dailyTotals(sessions: Session[]): Map<DateStr, number> {
  const map = new Map<DateStr, number>();
  for (const s of sessions) {
    const d = sessionDate(s);
    map.set(d, (map.get(d) ?? 0) + s.focusMinutes);
  }
  return map;
}

/** Tage in Folge mit mindestens `minMinutes` Lernzeit (heute zählt, sobald gelernt wurde). */
export function currentStreak(sessions: Session[], now = new Date(), minMinutes = 1): number {
  const totals = dailyTotals(sessions);
  let day = startOfDay(now);
  if ((totals.get(toDateStr(day)) ?? 0) < minMinutes) day = addDays(day, -1);
  let n = 0;
  while ((totals.get(toDateStr(day)) ?? 0) >= minMinutes) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function longestStreak(sessions: Session[], minMinutes = 1): number {
  const days = [...dailyTotals(sessions).entries()]
    .filter(([, m]) => m >= minMinutes)
    .map(([d]) => d)
    .sort();
  let best = 0;
  let run = 0;
  let prev: DateStr | null = null;
  for (const d of days) {
    if (prev && toDateStr(addDays(new Date(`${prev}T12:00`), 1)) === d) run++;
    else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export interface HourBucket {
  hour: number;
  minutes: number;
  ratingSum: number;
  ratingCount: number;
}

/** Lernzeit und Konzentration nach Tageszeit (Startstunde der Einheit) */
export function hourProfile(sessions: Session[]): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0, ratingSum: 0, ratingCount: 0 }));
  for (const s of sessions) {
    const h = new Date(s.start).getHours();
    buckets[h].minutes += s.focusMinutes;
    if (s.rating) {
      buckets[h].ratingSum += s.rating;
      buckets[h].ratingCount++;
    }
  }
  return buckets;
}

/** Zeitfenster (2 Stunden) mit der besten durchschnittlichen Konzentration */
export function bestFocusWindow(sessions: Session[], minRatings = 3): { from: number; to: number; avg: number } | null {
  const b = hourProfile(sessions);
  let best: { from: number; to: number; avg: number } | null = null;
  for (let h = 0; h < 23; h++) {
    const count = b[h].ratingCount + b[h + 1].ratingCount;
    if (count < minRatings) continue;
    const avg = (b[h].ratingSum + b[h + 1].ratingSum) / count;
    if (!best || avg > best.avg) best = { from: h, to: h + 2, avg };
  }
  return best;
}

export function averageRating(sessions: Session[]): number | null {
  const rated = sessions.filter((s) => s.rating);
  if (!rated.length) return null;
  return rated.reduce((a, s) => a + (s.rating ?? 0), 0) / rated.length;
}

/** Abgeschlossene Pomodoros je Aufgabe */
export function pomodorosByTask(sessions: Session[]): Map<ID, number> {
  const map = new Map<ID, number>();
  for (const s of sessions) {
    if (s.taskId && s.completed) map.set(s.taskId, (map.get(s.taskId) ?? 0) + 1);
  }
  return map;
}
