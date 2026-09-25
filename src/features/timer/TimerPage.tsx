import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronRight,
  Headphones,
  ListTodo,
  Minimize2,
  Pause,
  Play,
  Settings2,
  ShieldBan,
  SkipForward,
  Square,
  Waves,
} from "lucide-react";
import { ModuleSelect, ProgressBar, Segmented, Stepper, Switch } from "../../components/ui";
import { addDays, fmtClock, fmtHours, fmtTime, greeting, startOfDay } from "../../lib/time";
import { useNow } from "../../lib/useNow";
import { EVENT_TYPES } from "../../store/defaults";
import { useData, useSettings } from "../../store/data";
import { useNav } from "../../store/nav";
import type { TimerPreset } from "../../store/types";
import { expandEvents } from "../calendar/recurrence";
import { ambientToggle, useAmbient } from "../music/ambient";
import { currentStreak, pomodorosByTask, todayMinutes, weekMinutes } from "../stats/stats";
import { QuickAddTask } from "../tasks/QuickAdd";
import { TaskRow } from "../tasks/TaskRow";
import { setMiniMode } from "./mini";
import { TimerRing } from "./TimerRing";
import { WelcomeCard } from "./WelcomeCard";
import { PHASE_LABEL, remainingNow, spaceToggleHandler, useTimer, type Phase } from "./timerStore";

export const PHASE_COLOR: Record<Phase, string> = {
  focus: "var(--accent)",
  short: "var(--break)",
  long: "var(--long)",
};

export function TimerPage() {
  useEffect(() => {
    window.addEventListener("keydown", spaceToggleHandler);
    return () => window.removeEventListener("keydown", spaceToggleHandler);
  }, []);
  return (
    <div className="page timer-page">
      <div className="timer-layout">
        <TimerCard />
        <aside className="col gap-16">
          <WelcomeCard />
          <TodayCard />
          <TasksCard />
          <UpcomingCard />
        </aside>
      </div>
    </div>
  );
}

function TimerCard() {
  const t = useTimer();
  const settings = useSettings();
  const now = useNow(250, t.status === "running");
  const remaining = remainingNow(t, now);
  const progress = t.durationMs ? 1 - remaining / t.durationMs : 0;
  const longEvery = settings.timer.longEvery;

  const statusLine =
    t.status === "running"
      ? `läuft · endet um ${fmtTime(new Date(t.endsAt ?? now))}`
      : t.status === "paused"
        ? "pausiert"
        : t.phase === "focus"
          ? "bereit, wenn du es bist"
          : "Pause bereit";

  return (
    <section className="card timer-card">
      <div className="row between">
        {t.status === "idle" ? (
          <Segmented<Phase>
            value={t.phase}
            onChange={(p) => t.setPhase(p)}
            options={[
              { value: "focus", label: "Lernen" },
              { value: "short", label: "Kurze Pause" },
              { value: "long", label: "Lange Pause" },
            ]}
          />
        ) : (
          <span className="phase-pill" style={{ color: PHASE_COLOR[t.phase] }}>
            <span className="dot" style={{ background: PHASE_COLOR[t.phase] }} />
            {PHASE_LABEL[t.phase]}
          </span>
        )}
        <button className="icon-btn" onClick={() => void setMiniMode(true)} title="Mini-Timer (bleibt im Vordergrund)">
          <Minimize2 size={17} />
        </button>
      </div>

      <div className="timer-center">
        <TimerRing progress={progress} color={PHASE_COLOR[t.phase]}>
          <span className="timer-phase">{PHASE_LABEL[t.phase]}</span>
          <span className="timer-time tabular">{fmtClock(remaining)}</span>
          <span className="timer-status">{statusLine}</span>
          {longEvery > 0 && (
            <span className="cycle-dots" title={`${t.cycle} von ${longEvery} Lernphasen bis zur langen Pause`}>
              {Array.from({ length: longEvery }, (_, i) => (
                <span key={i} className={i < t.cycle ? "on" : ""} />
              ))}
            </span>
          )}
        </TimerRing>

        <div className="timer-controls">
          <button className="icon-btn lg bordered" onClick={t.stop} disabled={t.status === "idle"} title="Beenden">
            <Square size={16} />
          </button>
          <button className="play-btn" onClick={t.toggle} style={{ background: PHASE_COLOR[t.phase] }}>
            {t.status === "running" ? <Pause size={26} /> : <Play size={26} style={{ marginLeft: 3 }} />}
            <span>{t.status === "running" ? "Pause" : t.status === "paused" ? "Weiter" : "Start"}</span>
          </button>
          <button className="icon-btn lg bordered" onClick={t.skip} title="Phase überspringen">
            <SkipForward size={17} />
          </button>
        </div>
      </div>

      <PresetBar />
      <FocusTarget />
      <QuickToggles />
    </section>
  );
}

function presetMatches(p: TimerPreset, t: { focus: number; shortBreak: number; longBreak: number; longEvery: number }) {
  return p.focus === t.focus && p.shortBreak === t.shortBreak && p.longBreak === t.longBreak && p.longEvery === t.longEvery;
}

function PresetBar() {
  const timer = useSettings().timer;
  const setSettings = useData((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const custom = !timer.presets.some((p) => presetMatches(p, timer));

  const setTimer = (patch: Partial<typeof timer>) => setSettings((s) => ({ ...s, timer: { ...s.timer, ...patch } }));

  return (
    <div className="preset-bar">
      <div className="row wrap" style={{ justifyContent: "center" }}>
        {timer.presets.map((p) => (
          <button
            key={p.id}
            className={`chip ${presetMatches(p, timer) ? "active" : ""}`}
            onClick={() => setTimer({ focus: p.focus, shortBreak: p.shortBreak, longBreak: p.longBreak, longEvery: p.longEvery })}
            title={p.name}
          >
            {p.focus}/{p.shortBreak}
          </button>
        ))}
        <button className={`chip ${custom || open ? "active" : ""}`} onClick={() => setOpen(!open)}>
          <Settings2 size={13} />
          {custom ? `${timer.focus}/${timer.shortBreak}` : "Eigene"}
        </button>
      </div>
      {open && (
        <div className="preset-editor">
          <div className="field">
            <span className="field-label">Lernen</span>
            <Stepper value={timer.focus} min={5} max={180} step={5} suffix=" min" onChange={(v) => setTimer({ focus: v })} />
          </div>
          <div className="field">
            <span className="field-label">Pause</span>
            <Stepper value={timer.shortBreak} min={1} max={60} suffix=" min" onChange={(v) => setTimer({ shortBreak: v })} />
          </div>
          <div className="field">
            <span className="field-label">Lange Pause</span>
            <Stepper value={timer.longBreak} min={5} max={90} step={5} suffix=" min" onChange={(v) => setTimer({ longBreak: v })} />
          </div>
          <div className="field">
            <span className="field-label">Einheiten bis zur langen Pause</span>
            <Stepper value={timer.longEvery} min={0} max={8} onChange={(v) => setTimer({ longEvery: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

function FocusTarget() {
  const moduleId = useTimer((s) => s.moduleId);
  const taskId = useTimer((s) => s.taskId);
  const selectModule = useTimer((s) => s.selectModule);
  const selectTask = useTimer((s) => s.selectTask);
  const tasks = useData((s) => s.data.tasks);
  const open = tasks.filter((t) => !t.done && (moduleId ? t.moduleId === moduleId : true));

  return (
    <div className="focus-target">
      <span className="field-label">Woran arbeitest du?</span>
      <div className="row">
        <ModuleSelect value={moduleId} onChange={selectModule} noneLabel="Modul wählen …" />
        <select className="select" value={taskId ?? ""} onChange={(e) => selectTask(e.target.value || null)}>
          <option value="">{open.length ? "Aufgabe wählen (optional)" : "Keine offenen Aufgaben"}</option>
          {open.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function QuickToggles() {
  const settings = useSettings();
  const setSettings = useData((s) => s.setSettings);
  const ambientPlaying = useAmbient((s) => s.playing);
  const navigate = useNav((s) => s.navigate);
  const m = settings.music;

  const musicLabel =
    m.focusSource === "spotify"
      ? `Spotify${m.spotifyName ? ` · ${m.spotifyName}` : ""}`
      : m.focusSource === "local"
        ? "Eigene Musik"
        : "Quelle wählen";

  return (
    <div className="quick-toggles">
      <div className="quick-toggle">
        <div className="row between">
          <Headphones size={16} />
          <Switch
            checked={m.couple && m.focusSource !== "none"}
            disabled={m.focusSource === "none"}
            onChange={(v) => setSettings((s) => ({ ...s, music: { ...s.music, couple: v } }))}
          />
        </div>
        <span className="small">Musik</span>
        <button className="link-btn tiny ellipsis" onClick={() => navigate("music")} title={musicLabel}>
          {musicLabel} <ChevronRight size={11} />
        </button>
      </div>
      <div className="quick-toggle">
        <div className="row between">
          <Waves size={16} />
          <Switch checked={ambientPlaying} onChange={() => ambientToggle()} />
        </div>
        <span className="small">Geräusche</span>
        <button className="link-btn tiny ellipsis" onClick={() => navigate("music", "ambient")}>
          Mischung anpassen <ChevronRight size={11} />
        </button>
      </div>
      <div className="quick-toggle">
        <div className="row between">
          <ShieldBan size={16} />
          <Switch
            checked={settings.blocker.enabled}
            onChange={(v) => setSettings((s) => ({ ...s, blocker: { ...s.blocker, enabled: v } }))}
          />
        </div>
        <span className="small">Seiten sperren</span>
        <button className="link-btn tiny ellipsis" onClick={() => navigate("settings", "blocker")}>
          {settings.blocker.domains.length} Seiten in der Lernphase <ChevronRight size={11} />
        </button>
      </div>
    </div>
  );
}

function TodayCard() {
  const sessions = useData((s) => s.data.sessions);
  const moduleId = useTimer((s) => s.moduleId);
  const module = useData((s) => s.data.modules.find((m) => m.id === moduleId));
  useNow(60_000);
  const today = todayMinutes(sessions);
  const todayCount = sessions.filter((s) => new Date(s.start) >= startOfDay(new Date()) && s.completed).length;
  const streak = currentStreak(sessions);
  const week = weekMinutes(sessions);
  const moduleWeek = module ? weekMinutes(sessions, new Date(), module.id) : 0;

  return (
    <div className="card">
      <div className="card-header">
        <h3>{greeting()}</h3>
        <span className="hint">
          {new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
        </span>
      </div>
      <div className="grid cols-3" style={{ gap: 12 }}>
        <div className="stat">
          <span className="stat-label">Heute</span>
          <span className="stat-value">{fmtHours(today)}</span>
          <span className="stat-sub">
            {todayCount} {todayCount === 1 ? "Einheit" : "Einheiten"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Diese Woche</span>
          <span className="stat-value">{fmtHours(week)}</span>
          <span className="stat-sub">seit Montag</span>
        </div>
        <div className="stat">
          <span className="stat-label">Serie</span>
          <span className="stat-value">{streak}</span>
          <span className="stat-sub">{streak === 1 ? "Tag" : "Tage"} in Folge</span>
        </div>
      </div>
      {module && module.weeklyGoalMinutes > 0 && (
        <div className="mt-16 col gap-4">
          <div className="row between small">
            <span className="row gap-4">
              <span className="dot" style={{ background: module.color }} />
              Wochenziel {module.short || module.name}
            </span>
            <span className="muted tabular">
              {fmtHours(moduleWeek)} / {fmtHours(module.weeklyGoalMinutes)}
            </span>
          </div>
          <ProgressBar value={moduleWeek / module.weeklyGoalMinutes} color={module.color} />
        </div>
      )}
    </div>
  );
}

function TasksCard() {
  const moduleId = useTimer((s) => s.moduleId);
  const taskId = useTimer((s) => s.taskId);
  const selectTask = useTimer((s) => s.selectTask);
  const tasks = useData((s) => s.data.tasks);
  const sessions = useData((s) => s.data.sessions);
  const module = useData((s) => s.data.modules.find((m) => m.id === moduleId));
  const navigate = useNav((s) => s.navigate);
  const counts = useMemo(() => pomodorosByTask(sessions), [sessions]);

  const open = tasks
    .filter((t) => !t.done && (moduleId ? t.moduleId === moduleId : true))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  return (
    <div className="card">
      <div className="card-header">
        <h3>
          <ListTodo size={16} /> Aufgaben
        </h3>
        <button className="link-btn small" onClick={() => navigate("tasks")}>
          {module ? module.short || module.name : "Alle"} <ChevronRight size={12} />
        </button>
      </div>
      <div className="list">
        {open.slice(0, 6).map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            done={counts.get(t.id) ?? 0}
            showModule={!moduleId}
            selected={t.id === taskId}
            onFocus={() => selectTask(t.id)}
          />
        ))}
        {open.length > 6 && <span className="tiny faint" style={{ padding: "4px 8px" }}>+ {open.length - 6} weitere</span>}
        {!open.length && <p className="small faint" style={{ padding: "4px 8px" }}>Keine offenen Aufgaben – plane deine nächsten Schritte.</p>}
      </div>
      <QuickAddTask moduleId={moduleId} showModule={!moduleId} compact />
    </div>
  );
}

function UpcomingCard() {
  const events = useData((s) => s.data.events);
  const selectModule = useTimer((s) => s.selectModule);
  const timer = useTimer();
  const navigate = useNav((s) => s.navigate);
  const now = useNow(60_000);

  const upcoming = useMemo(() => {
    const start = startOfDay(new Date(now));
    return expandEvents(events, start, addDays(start, 1)).filter((i) => i.end.getTime() > now && !i.event.allDay);
  }, [events, now]);

  const startBlock = (moduleId: string | null) => {
    selectModule(moduleId);
    if (timer.status === "idle") {
      timer.setPhase("focus");
      timer.start();
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3>
          <CalendarClock size={16} /> Heute noch
        </h3>
        <button className="link-btn small" onClick={() => navigate("calendar")}>
          Kalender <ChevronRight size={12} />
        </button>
      </div>
      {upcoming.length ? (
        <div className="list">
          {upcoming.slice(0, 5).map((i) => {
            const color = EVENT_TYPES[i.event.type].color;
            const live = i.start.getTime() <= now;
            return (
              <div key={i.key} className="list-item upcoming-item">
                <span className="upcoming-bar" style={{ background: color }} />
                <div className="grow col" style={{ gap: 0 }}>
                  <span className="ellipsis small strong">{i.event.title}</span>
                  <span className="tiny faint tabular">
                    {fmtTime(i.start)}–{fmtTime(i.end)} · {EVENT_TYPES[i.event.type].label}
                    {live ? " · läuft" : ""}
                  </span>
                </div>
                {i.event.type === "study" && timer.status === "idle" && (
                  <button className="btn sm soft" onClick={() => startBlock(i.event.moduleId)}>
                    <Play size={13} /> Start
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="small faint">Keine weiteren Termine heute.</p>
      )}
      {upcoming.length === 0 && (
        <p className="tiny faint mt-8">Tipp: Plane Lernblöcke im Kalender und starte sie hier mit einem Klick.</p>
      )}
    </div>
  );
}
