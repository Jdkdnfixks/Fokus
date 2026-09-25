import ICAL from "ical.js";
import { uid } from "../../lib/ids";
import { toDateStr, toLocalDT } from "../../lib/time";
import type { CalEvent, EventType, ID, Module } from "../../store/types";

export interface IcalImportOptions {
  type: EventType;
  moduleId: ID | null;
  /** Modul anhand des Titels erkennen, wenn `moduleId` leer ist */
  autoModule: boolean;
  modules: Module[];
  /** Kennung der Quelle (Datei oder Abo) – ersetzt frühere Importe derselben Quelle */
  feed: string;
  from: Date;
  until: Date;
}

export interface IcalImportResult {
  events: CalEvent[];
  skipped: number;
}

const MAX_OCCURRENCES = 1500;

function guessType(summary: string, fallback: EventType): EventType {
  const s = summary.toLowerCase();
  if (/klausur|prüfung|exam/.test(s)) return "exam";
  if (/übung|tutorium|exercise|tutorial/.test(s)) return "exercise";
  if (/abgabe|deadline|frist/.test(s)) return "deadline";
  if (/vorlesung|lecture|\bvl\b/.test(s)) return "lecture";
  return fallback;
}

function guessModule(summary: string, modules: Module[]): ID | null {
  const s = summary.toLowerCase();
  const hit = modules.find(
    (m) => !m.archived && ((m.short && s.includes(m.short.toLowerCase())) || s.includes(m.name.toLowerCase())),
  );
  return hit?.id ?? null;
}

/** Wandelt iCal-Text (.ics) in Fokus-Termine um. Serien werden in Einzeltermine aufgelöst. */
export function parseIcal(text: string, opts: IcalImportOptions): IcalImportResult {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* unbekannte Zeitzone – Termine werden dann als Ortszeit gelesen */
    }
  }

  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, InstanceType<typeof ICAL.Event>>();
  const exceptions: InstanceType<typeof ICAL.Event>[] = [];
  for (const v of vevents) {
    const ev = new ICAL.Event(v);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid || uid(), ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
  }

  const out: CalEvent[] = [];
  let skipped = 0;

  const push = (ev: InstanceType<typeof ICAL.Event>, start: Date, end: Date, allDay: boolean) => {
    if (end < opts.from || start > opts.until) {
      skipped++;
      return;
    }
    const summary = (ev.summary || "Termin").trim();
    const moduleId = opts.moduleId ?? (opts.autoModule ? guessModule(summary, opts.modules) : null);
    out.push({
      id: uid(),
      title: summary,
      type: guessType(summary, opts.type),
      start: allDay ? toDateStr(start) : toLocalDT(start),
      end: allDay ? toDateStr(end) : toLocalDT(end),
      allDay,
      moduleId,
      location: ev.location?.trim() || undefined,
      notes: ev.description?.trim().slice(0, 2000) || undefined,
      source: { kind: "ical", ref: ev.uid, feed: opts.feed },
    });
  };

  for (const ev of masters.values()) {
    try {
      const allDay = ev.startDate.isDate;
      if (!ev.isRecurring()) {
        const start = ev.startDate.toJSDate();
        const end = ev.endDate ? ev.endDate.toJSDate() : start;
        push(ev, start, end, allDay);
        continue;
      }
      const it = ev.iterator();
      let count = 0;
      for (let next = it.next(); next && count < MAX_OCCURRENCES; next = it.next()) {
        const details = ev.getOccurrenceDetails(next);
        const start = details.startDate.toJSDate();
        if (start > opts.until) break;
        const end = details.endDate.toJSDate();
        push(details.item, start, end, allDay);
        count++;
      }
    } catch {
      skipped++;
    }
  }

  return { events: out, skipped };
}
