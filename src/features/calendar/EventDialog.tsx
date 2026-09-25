import { useState } from "react";
import { Play, Repeat } from "lucide-react";
import { Modal, ModuleSelect, Segmented, Switch, ask } from "../../components/ui";
import { uid } from "../../lib/ids";
import { WEEK_ORDER, WEEKDAYS_SHORT, addDays, parseLocal, toDateStr } from "../../lib/time";
import { EVENT_TYPES } from "../../store/defaults";
import { useData } from "../../store/data";
import { useNav } from "../../store/nav";
import type { CalEvent, EventType, ID } from "../../store/types";
import { useTimer } from "../timer/timerStore";

export interface EventDraftInput {
  /** bestehender Termin (oder Serie) */
  event?: CalEvent;
  /** Datum des angeklickten Vorkommens (bei Serien) */
  occurrenceDate?: string;
  /** Vorbelegung für neue Termine */
  start?: Date;
  end?: Date;
  allDay?: boolean;
}

function timeOf(s: string): string {
  return s.includes("T") ? s.split("T")[1].slice(0, 5) : "09:00";
}

export function EventDialog({ input, onClose }: { input: EventDraftInput; onClose: () => void }) {
  const upsert = useData((s) => s.upsert);
  const patch = useData((s) => s.patch);
  const remove = useData((s) => s.remove);
  const navigate = useNav((s) => s.navigate);
  const existing = input.event;
  const isSeries = !!existing?.recurrence;

  const initStart = existing ? parseLocal(existing.start) : input.start ?? new Date();
  const initEnd = existing ? parseLocal(existing.end) : input.end ?? new Date(initStart.getTime() + 90 * 60000);
  const allDayInit = existing?.allDay ?? input.allDay ?? false;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [type, setType] = useState<EventType>(existing?.type ?? "study");
  const [moduleId, setModuleId] = useState<ID | null>(existing?.moduleId ?? null);
  const [allDay, setAllDay] = useState(allDayInit);
  const [date, setDate] = useState(
    isSeries && input.occurrenceDate ? input.occurrenceDate : toDateStr(initStart),
  );
  const [endDate, setEndDate] = useState(
    allDayInit ? toDateStr(addDays(initEnd, -1)) : toDateStr(initEnd),
  );
  const [startTime, setStartTime] = useState(existing ? timeOf(existing.start) : toLocalTime(initStart));
  const [endTime, setEndTime] = useState(existing ? timeOf(existing.end) : toLocalTime(initEnd));
  const [repeat, setRepeat] = useState(isSeries);
  const [weeks, setWeeks] = useState(existing?.recurrence?.interval ?? 1);
  const [byDay, setByDay] = useState<number[]>(existing?.recurrence?.byDay ?? [initStart.getDay()]);
  const [until, setUntil] = useState(existing?.recurrence?.until ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [scope, setScope] = useState<"one" | "series">("series");

  const valid = title.trim().length > 0 && (allDay || endDateTime() > startDateTime());

  function startDateTime() {
    return allDay ? date : `${date}T${startTime}`;
  }
  function endDateTime() {
    if (allDay) return toDateStr(addDays(parseLocal(endDate < date ? date : endDate), 1));
    // Termin über Mitternacht: Ende am Folgetag
    return endTime <= startTime ? `${toDateStr(addDays(parseLocal(date), 1))}T${endTime}` : `${date}T${endTime}`;
  }

  const build = (base: Partial<CalEvent>): CalEvent => ({
    id: base.id ?? uid(),
    title: title.trim(),
    type,
    moduleId,
    allDay,
    start: startDateTime(),
    end: endDateTime(),
    location: location.trim() || undefined,
    notes: notes.trim() || undefined,
    recurrence: repeat ? { freq: "weekly", interval: weeks, byDay: byDay.length ? byDay : undefined, until: until || undefined } : undefined,
    exdates: base.exdates,
    source: base.source,
  });

  const save = () => {
    if (!valid) return;
    if (existing && isSeries && scope === "one" && input.occurrenceDate) {
      // nur dieses Vorkommen: Ausnahme in der Serie + Einzeltermin
      patch("events", existing.id, { exdates: [...(existing.exdates ?? []), input.occurrenceDate] });
      upsert("events", { ...build({ source: existing.source }), recurrence: undefined });
    } else if (existing && isSeries && scope === "series") {
      // Serie: Startdatum der Serie bleibt, sofern das Datum nicht geändert wurde
      const seriesStart = date === input.occurrenceDate ? existing.start.slice(0, 10) : date;
      const ev = build(existing);
      const shift = (s: string) => (s.includes("T") ? `${seriesStart}${s.slice(10)}` : seriesStart);
      const dayDiff = Math.round((parseLocal(ev.end.slice(0, 10)).getTime() - parseLocal(ev.start.slice(0, 10)).getTime()) / 86400000);
      const endDay = toDateStr(addDays(parseLocal(seriesStart), dayDiff));
      upsert("events", { ...ev, start: shift(ev.start), end: ev.end.includes("T") ? `${endDay}${ev.end.slice(10)}` : endDay });
    } else {
      upsert("events", build(existing ?? {}));
    }
    onClose();
  };

  const del = async () => {
    if (!existing) return;
    if (isSeries && input.occurrenceDate) {
      const choice = await ask("Serientermin löschen", "Soll nur dieser Termin oder die ganze Serie gelöscht werden?", [
        { value: "one", label: "Nur diesen Termin" },
        { value: "all", label: "Ganze Serie", kind: "danger" },
      ]);
      if (choice === "one") patch("events", existing.id, { exdates: [...(existing.exdates ?? []), input.occurrenceDate] });
      else if (choice === "all") remove("events", existing.id);
      else return;
    } else {
      remove("events", existing.id);
    }
    onClose();
  };

  const startNow = () => {
    const t = useTimer.getState();
    t.selectModule(moduleId);
    if (t.status === "idle") {
      t.setPhase("focus");
      t.start();
    }
    onClose();
    navigate("timer");
  };

  return (
    <Modal
      title={existing ? "Termin bearbeiten" : "Neuer Termin"}
      onClose={onClose}
      footer={
        <>
          <div className="left">
            {existing && (
              <button className="btn ghost danger" onClick={() => void del()}>
                Löschen
              </button>
            )}
            {existing && (type === "study" || moduleId) && (
              <button className="btn soft" onClick={startNow}>
                <Play size={14} /> Jetzt lernen
              </button>
            )}
          </div>
          <button className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={save} disabled={!valid}>
            Speichern
          </button>
        </>
      }
    >
      <div className="col gap-12">
        {existing && isSeries && (
          <div className="row between">
            <span className="small muted row gap-4">
              <Repeat size={14} /> Serientermin
            </span>
            <Segmented<"one" | "series">
              value={scope}
              onChange={setScope}
              options={[
                { value: "one", label: "Nur dieser Termin" },
                { value: "series", label: "Ganze Serie" },
              ]}
            />
          </div>
        )}
        <input
          className="input"
          style={{ fontSize: 15, height: 38 }}
          autoFocus={!existing}
          placeholder="Titel, z. B. Lernblock Corporate Finance"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <div className="row wrap gap-4">
          {(Object.keys(EVENT_TYPES) as EventType[]).map((t) => (
            <button key={t} className={`chip ${type === t ? "active" : ""}`} onClick={() => setType(t)}>
              <span className="dot" style={{ background: EVENT_TYPES[t].color }} />
              {EVENT_TYPES[t].label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <div className="field">
            <label>{allDay ? "Von" : "Datum"}</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {allDay ? (
            <div className="field">
              <label>Bis</label>
              <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          ) : (
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field grow">
                <label>Beginn</label>
                <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="field grow">
                <label>Ende</label>
                <input type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
          )}
          <div className="field">
            <label>Modul</label>
            <ModuleSelect value={moduleId} onChange={setModuleId} />
          </div>
          <div className="field">
            <label>Ort</label>
            <input className="input" value={location} placeholder="z. B. HGA 20" onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>
        <div className="row gap-24 wrap">
          <Switch checked={allDay} onChange={setAllDay} label="Ganztägig" />
          {!(existing && isSeries && scope === "one") && <Switch checked={repeat} onChange={setRepeat} label="Wöchentlich wiederholen" />}
        </div>
        {repeat && !(existing && isSeries && scope === "one") && (
          <div className="card flat tight col gap-12">
            <div className="row wrap gap-12">
              <Segmented<number>
                value={weeks}
                onChange={setWeeks}
                options={[
                  { value: 1, label: "jede Woche" },
                  { value: 2, label: "alle 2 Wochen" },
                ]}
              />
              <div className="row gap-4">
                {WEEK_ORDER.map((d) => (
                  <button
                    key={d}
                    className={`chip ${byDay.includes(d) ? "active" : ""}`}
                    style={{ padding: "0 9px" }}
                    onClick={() => setByDay(byDay.includes(d) ? byDay.filter((x) => x !== d) : [...byDay, d])}
                  >
                    {WEEKDAYS_SHORT[d]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ maxWidth: 220 }}>
              <label>Endet am (optional, z. B. Vorlesungsende)</label>
              <input type="date" className="input" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          </div>
        )}
        <div className="field">
          <label>Notizen</label>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {existing?.source?.kind === "ical" && (
          <p className="tiny faint">Aus einem importierten Kalender. Beim nächsten Import werden Änderungen überschrieben.</p>
        )}
      </div>
    </Modal>
  );
}

function toLocalTime(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
