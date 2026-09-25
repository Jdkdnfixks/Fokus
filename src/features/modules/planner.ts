import { addDays, daysBetween, minutesToTime, parseLocal, startOfDay, timeToMinutes, toDateStr } from "../../lib/time";
import type { CalEvent, DateStr, ExamPlan, ExamPlanSettings, ID } from "../../store/types";
import { expandEvents } from "../calendar/recurrence";

/**
 * Klausur-Rückwärtsplanung: verteilt die Kapitel eines Moduls als Lernblöcke
 * gleichmäßig auf die freien Zeiten im Kalender bis zur Klausur. Die letzten
 * Tage vor der Klausur bleiben für Wiederholung reserviert.
 */

export interface PlannedBlock {
  date: DateStr;
  start: string;
  end: string;
  title: string;
  chapterId: ID | null;
  kind: "chapter" | "review";
}

export interface PlanResult {
  blocks: PlannedBlock[];
  /** benötigte Kapitel-Blöcke */
  needed: number;
  /** freie Slots im Lernzeitraum */
  available: number;
  /** Blöcke, die nicht untergebracht werden konnten */
  missing: number;
  studyDays: number;
  reviewPlaced: number;
}

export function defaultPlanSettings(focusMinutes: number): ExamPlanSettings {
  return {
    blockMinutes: focusMinutes,
    breakMinutes: 10,
    maxBlocksPerDay: 3,
    days: [1, 2, 3, 4, 5, 6],
    dayStart: "09:00",
    dayEnd: "18:00",
    reviewDays: 3,
    reviewBlocks: 6,
  };
}

interface Slot {
  date: DateStr;
  start: number;
  end: number;
}

function freeSlots(
  date: Date,
  settings: ExamPlanSettings,
  busy: { start: number; end: number }[],
  earliest: number,
): Slot[] {
  const dayStart = timeToMinutes(settings.dayStart);
  const dayEnd = timeToMinutes(settings.dayEnd);
  const out: Slot[] = [];
  let t = Math.max(dayStart, Math.ceil(earliest / 15) * 15);
  while (t + settings.blockMinutes <= dayEnd && out.length < settings.maxBlocksPerDay) {
    const end = t + settings.blockMinutes;
    const clash = busy.find((b) => b.start < end && b.end > t);
    if (clash) {
      t = Math.ceil(clash.end / 15) * 15;
      continue;
    }
    out.push({ date: toDateStr(date), start: t, end });
    t = end + settings.breakMinutes;
  }
  return out;
}

/** Wählt `n` möglichst gleichmäßig verteilte Einträge aus `items`. */
export function spread<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (n >= items.length) return [...items];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)]);
  return out;
}

export function generatePlan(opts: {
  plan: ExamPlan;
  moduleLabel: string;
  examDate: DateStr;
  events: CalEvent[];
  now: Date;
}): PlanResult {
  const { plan, moduleLabel, examDate, events, now } = opts;
  const s = plan.settings;

  // Kapitel in einzelne Blöcke zerlegen
  const units: { chapterId: ID; title: string }[] = [];
  for (const ch of plan.chapters) {
    if (ch.done || ch.blocks <= 0) continue;
    for (let i = 1; i <= ch.blocks; i++) {
      units.push({ chapterId: ch.id, title: `${moduleLabel}: ${ch.title}${ch.blocks > 1 ? ` (${i}/${ch.blocks})` : ""}` });
    }
  }

  const today = startOfDay(now);
  let first = today;
  if (s.startDate && parseLocal(s.startDate) > first) first = parseLocal(s.startDate);
  const exam = parseLocal(examDate);
  const totalDays = daysBetween(toDateStr(first), examDate);
  if (totalDays <= 0) {
    return { blocks: [], needed: units.length, available: 0, missing: units.length, studyDays: 0, reviewPlaced: 0 };
  }

  // Belegte Zeiten (eigene, bereits geplante Blöcke dieses Plans zählen nicht)
  const others = events.filter((e) => e.source?.planId !== plan.id);
  const instances = expandEvents(others, first, exam).filter((i) => !i.event.allDay);
  const busyByDay = new Map<DateStr, { start: number; end: number }[]>();
  for (const i of instances) {
    const key = toDateStr(i.start);
    const startMin = i.start.getHours() * 60 + i.start.getMinutes();
    const endMin = toDateStr(i.end) === key ? i.end.getHours() * 60 + i.end.getMinutes() : 24 * 60;
    const list = busyByDay.get(key) ?? [];
    list.push({ start: startMin, end: endMin });
    busyByDay.set(key, list);
  }

  const reviewDays = Math.min(s.reviewDays, totalDays);
  const studySlots: Slot[] = [];
  const reviewSlots: Slot[] = [];
  let studyDays = 0;
  for (let d = 0; d < totalDays; d++) {
    const date = addDays(first, d);
    if (!s.days.includes(date.getDay())) continue;
    const isToday = toDateStr(date) === toDateStr(now);
    const earliest = isToday ? now.getHours() * 60 + now.getMinutes() + 15 : 0;
    const slots = freeSlots(date, s, busyByDay.get(toDateStr(date)) ?? [], earliest);
    const daysLeft = totalDays - d;
    if (daysLeft <= reviewDays) reviewSlots.push(...slots);
    else {
      if (slots.length) studyDays++;
      studySlots.push(...slots);
    }
  }

  const chosen = spread(studySlots, units.length);
  const blocks: PlannedBlock[] = chosen.map((slot, i) => ({
    date: slot.date,
    start: minutesToTime(slot.start),
    end: minutesToTime(slot.end),
    title: units[i].title,
    chapterId: units[i].chapterId,
    kind: "chapter",
  }));

  const reviewChosen = spread(reviewSlots, s.reviewBlocks);
  for (const slot of reviewChosen) {
    blocks.push({
      date: slot.date,
      start: minutesToTime(slot.start),
      end: minutesToTime(slot.end),
      title: `${moduleLabel}: Wiederholung`,
      chapterId: null,
      kind: "review",
    });
  }

  blocks.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return {
    blocks,
    needed: units.length,
    available: studySlots.length,
    missing: Math.max(0, units.length - studySlots.length),
    studyDays,
    reviewPlaced: reviewChosen.length,
  };
}
