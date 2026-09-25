import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import deLocale from "@fullcalendar/core/locales/de";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { CalendarPlus, ChevronLeft, ChevronRight, Download, MapPin } from "lucide-react";
import { Segmented, ask } from "../../components/ui";
import { uid } from "../../lib/ids";
import { addDays, isoWeek, parseLocal, startOfWeek, toDateStr, toLocalDT } from "../../lib/time";
import { EVENT_TYPES } from "../../store/defaults";
import { useData, useSettings } from "../../store/data";
import type { CalEvent, EventType } from "../../store/types";
import { EventDialog, type EventDraftInput } from "./EventDialog";
import { ImportDialog } from "./ImportDialog";
import { expandEvents, parseInstanceKey } from "./recurrence";

type View = "timeGridWeek" | "timeGridDay" | "dayGridMonth";

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function CalendarPage() {
  const events = useData((s) => s.data.events);
  const modules = useData((s) => s.data.modules);
  const upsert = useData((s) => s.upsert);
  const patch = useData((s) => s.patch);
  const general = useSettings().general;
  const calRef = useRef<FullCalendar>(null);
  const [range, setRange] = useState<{ start: Date; end: Date; title: string } | null>(null);
  const [view, setView] = useState<View>("timeGridWeek");
  const [dialog, setDialog] = useState<EventDraftInput | null>(null);
  const [importing, setImporting] = useState(false);
  const [hidden, setHidden] = useState<Set<EventType>>(new Set());

  const moduleColor = useMemo(() => new Map(modules.map((m) => [m.id, m.color])), [modules]);

  const fcEvents = useMemo(() => {
    if (!range) return [];
    return expandEvents(events, range.start, range.end)
      .filter((i) => !hidden.has(i.event.type))
      .map((i) => {
        const color = (i.event.moduleId && moduleColor.get(i.event.moduleId)) || EVENT_TYPES[i.event.type].color;
        return {
          id: i.key,
          title: i.event.title,
          start: i.start,
          end: i.end,
          allDay: i.event.allDay,
          backgroundColor: hexToRgba(color, i.event.type === "private" ? 0.14 : 0.2),
          borderColor: color,
          textColor: "var(--text)",
          classNames: [`ev-${i.event.type}`],
          extendedProps: { location: i.event.location, type: i.event.type, recurring: !!i.event.recurrence },
        };
      });
  }, [events, range, hidden, moduleColor]);

  const api = () => calRef.current?.getApi();

  const onDatesSet = (arg: DatesSetArg) => {
    const start = arg.view.currentStart;
    const title =
      arg.view.type === "dayGridMonth"
        ? start.toLocaleDateString("de-DE", { month: "long", year: "numeric" })
        : arg.view.type === "timeGridWeek"
          ? `KW ${isoWeek(start)} · ${start.toLocaleDateString("de-DE", { day: "numeric", month: "short" })} – ${addDays(arg.view.currentEnd, -1).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })}`
          : start.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    setRange({ start: arg.start, end: arg.end, title });
  };

  const findEvent = (key: string) => {
    const { eventId, date } = parseInstanceKey(key);
    return { ev: events.find((e) => e.id === eventId), date };
  };

  const onSelect = (arg: DateSelectArg) => {
    setDialog({ start: arg.start, end: arg.end, allDay: arg.allDay });
    api()?.unselect();
  };

  const onEventClick = (arg: EventClickArg) => {
    const { ev, date } = findEvent(arg.event.id);
    if (ev) setDialog({ event: ev, occurrenceDate: date });
  };

  /** Verschieben / Größe ändern per Maus */
  const onChangeTimes = async (arg: EventDropArg | EventResizeDoneArg) => {
    const { ev, date } = findEvent(arg.event.id);
    const newStart = arg.event.start;
    const newEnd = arg.event.end ?? (newStart ? new Date(newStart.getTime() + 3600_000) : null);
    if (!ev || !newStart || !newEnd) return arg.revert();
    const allDay = arg.event.allDay;
    const fmt = (d: Date) => (allDay ? toDateStr(d) : toLocalDT(d));

    if (!ev.recurrence) {
      patch("events", ev.id, { start: fmt(newStart), end: fmt(newEnd), allDay });
      return;
    }
    const choice = await ask("Serientermin verschieben", "Soll nur dieser Termin oder die ganze Serie geändert werden?", [
      { value: "one", label: "Nur diesen Termin" },
      { value: "all", label: "Ganze Serie", kind: "primary" },
    ]);
    if (choice === "one") {
      patch("events", ev.id, { exdates: [...(ev.exdates ?? []), date] });
      const single: CalEvent = { ...ev, id: uid(), recurrence: undefined, exdates: undefined, start: fmt(newStart), end: fmt(newEnd), allDay };
      upsert("events", single);
    } else if (choice === "all") {
      const oldStart = arg.oldEvent.start!;
      const delta = newStart.getTime() - oldStart.getTime();
      const dayDelta = Math.round((toDay(newStart) - toDay(oldStart)) / 86400000);
      const baseStart = new Date(parseLocal(ev.start).getTime() + delta);
      const oldDuration = (arg.oldEvent.end?.getTime() ?? oldStart.getTime()) - oldStart.getTime();
      const newDuration = newEnd.getTime() - newStart.getTime();
      const baseEnd = new Date(parseLocal(ev.end).getTime() + delta + (newDuration - oldDuration));
      const byDay = ev.recurrence.byDay?.map((d) => (((d + dayDelta) % 7) + 7) % 7);
      patch("events", ev.id, {
        start: fmt(baseStart),
        end: fmt(baseEnd),
        allDay,
        recurrence: { ...ev.recurrence, byDay },
      });
    } else {
      arg.revert();
    }
  };

  const eventContent = (arg: EventContentArg) => {
    const loc = arg.event.extendedProps.location as string | undefined;
    const short = arg.view.type !== "dayGridMonth" && arg.event.end && arg.event.start && arg.event.end.getTime() - arg.event.start.getTime() <= 45 * 60000;
    return (
      <div className={`fc-ev ${short ? "short" : ""}`}>
        {!arg.event.allDay && <span className="fc-ev-time">{arg.timeText}</span>}
        <span className="fc-ev-title">{arg.event.title}</span>
        {loc && !short && (
          <span className="fc-ev-loc">
            <MapPin size={10} /> {loc}
          </span>
        )}
      </div>
    );
  };

  const changeView = (v: View) => {
    setView(v);
    api()?.changeView(v);
  };

  return (
    <div className="page full wide calendar-page">
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div className="row gap-12">
          <div className="row gap-4">
            <button className="icon-btn bordered" onClick={() => api()?.prev()} aria-label="Zurück">
              <ChevronLeft size={17} />
            </button>
            <button className="btn" onClick={() => api()?.today()}>
              Heute
            </button>
            <button className="icon-btn bordered" onClick={() => api()?.next()} aria-label="Weiter">
              <ChevronRight size={17} />
            </button>
          </div>
          <h2 className="calendar-title">{range?.title}</h2>
        </div>
        <div className="row gap-12">
          <Segmented<View>
            value={view}
            onChange={changeView}
            options={[
              { value: "timeGridDay", label: "Tag" },
              { value: "timeGridWeek", label: "Woche" },
              { value: "dayGridMonth", label: "Monat" },
            ]}
          />
          <button className="btn" onClick={() => setImporting(true)}>
            <Download size={15} /> Importieren
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const start = new Date();
              start.setMinutes(0, 0, 0);
              start.setHours(start.getHours() + 1);
              setDialog({ start, end: new Date(start.getTime() + 90 * 60000) });
            }}
          >
            <CalendarPlus size={15} /> Termin
          </button>
        </div>
      </div>

      <div className="calendar-wrap card">
        <FullCalendar
          ref={calRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          locale={deLocale}
          initialView={view}
          initialDate={startOfWeek(new Date())}
          headerToolbar={false}
          height="100%"
          firstDay={1}
          nowIndicator
          allDaySlot
          allDayText="ganztägig"
          slotMinTime={`${String(Math.max(0, general.dayStartHour - 1)).padStart(2, "0")}:00:00`}
          slotMaxTime={`${String(Math.min(24, general.dayEndHour + 1)).padStart(2, "0")}:00:00`}
          scrollTime={`${String(general.dayStartHour).padStart(2, "0")}:00:00`}
          slotDuration="00:30:00"
          snapDuration="00:15:00"
          slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          dayHeaderFormat={view === "dayGridMonth" ? { weekday: "short" } : { weekday: "short", day: "numeric", month: "numeric" }}
          selectable
          selectMirror
          editable
          eventResizableFromStart={false}
          dayMaxEvents={4}
          expandRows
          events={fcEvents}
          datesSet={onDatesSet}
          select={onSelect}
          eventClick={onEventClick}
          eventDrop={(a) => void onChangeTimes(a)}
          eventResize={(a) => void onChangeTimes(a)}
          eventContent={eventContent}
        />
      </div>

      <div className="row wrap gap-12 mt-12 calendar-legend">
        {(Object.keys(EVENT_TYPES) as EventType[]).map((t) => (
          <button
            key={t}
            className={`legend-item ${hidden.has(t) ? "off" : ""}`}
            onClick={() => {
              const next = new Set(hidden);
              if (next.has(t)) next.delete(t);
              else next.add(t);
              setHidden(next);
            }}
            title={hidden.has(t) ? "Einblenden" : "Ausblenden"}
          >
            <span className="dot" style={{ background: EVENT_TYPES[t].color }} />
            {EVENT_TYPES[t].label}
          </button>
        ))}
        <span className="tiny faint" style={{ marginLeft: "auto" }}>
          Ziehe in einem freien Bereich, um einen Termin anzulegen. Termine lassen sich per Maus verschieben.
        </span>
      </div>

      {dialog && <EventDialog input={dialog} onClose={() => setDialog(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

function toDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
