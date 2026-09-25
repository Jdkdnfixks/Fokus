import { addDays, DAY, parseLocal, startOfWeek, toDateStr } from "../../lib/time";
import type { CalEvent, DateStr } from "../../store/types";

export interface EventInstance {
  /** eindeutiger Schlüssel des Vorkommens: `<eventId>::<datum>` */
  key: string;
  event: CalEvent;
  start: Date;
  end: Date;
  /** Datum des Vorkommens (für Ausnahmen in Serien) */
  date: DateStr;
}

export function instanceKey(eventId: string, date: DateStr) {
  return `${eventId}::${date}`;
}

export function parseInstanceKey(key: string): { eventId: string; date: DateStr } {
  const [eventId, date] = key.split("::");
  return { eventId, date };
}

function overlaps(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) {
  return start < rangeEnd && end > rangeStart;
}

/** Löst wiederkehrende Termine im Zeitraum [rangeStart, rangeEnd) in einzelne Vorkommen auf. */
export function expandEvents(events: CalEvent[], rangeStart: Date, rangeEnd: Date): EventInstance[] {
  const out: EventInstance[] = [];
  for (const ev of events) {
    const baseStart = parseLocal(ev.start);
    const baseEnd = parseLocal(ev.end);
    const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());

    if (!ev.recurrence) {
      if (overlaps(baseStart, baseEnd, rangeStart, rangeEnd) || (durationMs === 0 && baseStart >= rangeStart && baseStart < rangeEnd)) {
        const date = toDateStr(baseStart);
        out.push({ key: instanceKey(ev.id, date), event: ev, start: baseStart, end: baseEnd, date });
      }
      continue;
    }

    const rec = ev.recurrence;
    const interval = Math.max(1, rec.interval || 1);
    const days = rec.byDay && rec.byDay.length ? rec.byDay : [baseStart.getDay()];
    const exdates = new Set(ev.exdates ?? []);
    const week0 = startOfWeek(baseStart);
    const firstDate = toDateStr(baseStart);
    const hh = baseStart.getHours();
    const mm = baseStart.getMinutes();

    // erste relevante Woche (eine Woche Puffer für Termine über Mitternacht)
    let w = Math.max(0, Math.floor((rangeStart.getTime() - week0.getTime()) / (7 * DAY)) - 1);
    w -= w % interval;
    for (let guard = 0; guard < 600; guard++, w += interval) {
      const weekStart = addDays(week0, w * 7);
      if (weekStart >= rangeEnd) break;
      if (rec.until && toDateStr(weekStart) > rec.until) break;
      for (const day of days) {
        const d = addDays(weekStart, (day + 6) % 7);
        const date = toDateStr(d);
        if (date < firstDate) continue;
        if (rec.until && date > rec.until) continue;
        if (exdates.has(date)) continue;
        const start = ev.allDay ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
        const end = new Date(start.getTime() + durationMs);
        if (overlaps(start, end, rangeStart, rangeEnd)) {
          out.push({ key: instanceKey(ev.id, date), event: ev, start, end, date });
        }
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
