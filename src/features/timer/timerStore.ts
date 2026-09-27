import { create } from "zustand";
import { uid } from "../../lib/ids";
import { MINUTE } from "../../lib/time";
import { useData } from "../../store/data";
import type { ID, Session } from "../../store/types";

export type Phase = "focus" | "short" | "long";
export type RunStatus = "idle" | "running" | "paused";

export const PHASE_LABEL: Record<Phase, string> = {
  focus: "Lernphase",
  short: "Kurze Pause",
  long: "Lange Pause",
};

/** Eine abgebrochene Lernphase zählt ab dieser Dauer als Einheit. */
const MIN_PARTIAL_MS = MINUTE;

export interface PhaseEndInfo {
  from: Phase;
  to: Phase;
  natural: boolean;
  sessionId: ID | null;
  /** alle Einheiten des Durchgangs geschafft – Timer wartet */
  roundComplete: boolean;
}

type TimerSettings = ReturnType<typeof useData.getState>["data"]["settings"]["timer"];

export interface NextStep {
  next: Phase;
  autoStart: boolean;
  cycle: number;
  roundComplete: boolean;
}

/**
 * Was nach einer Phase kommt. `cycle` = geschaffte Lerneinheiten inklusive der
 * gerade beendeten. Innerhalb eines Durchgangs laufen die Phasen automatisch
 * weiter; nach der letzten Einheit folgt (falls eingestellt) die lange Pause,
 * danach stoppt der Timer.
 */
export function planNext(from: Phase, cycle: number, t: TimerSettings): NextStep {
  const units = t.longEvery;
  if (from === "focus") {
    if (units <= 0 || cycle < units) return { next: "short", autoStart: t.autoContinue, cycle, roundComplete: false };
    if (t.longBreak > 0) return { next: "long", autoStart: t.autoContinue, cycle, roundComplete: false };
    return { next: "focus", autoStart: false, cycle: 0, roundComplete: true };
  }
  if (from === "long") return { next: "focus", autoStart: false, cycle: 0, roundComplete: true };
  return { next: "focus", autoStart: t.autoContinue, cycle, roundComplete: false };
}

interface TimerState {
  phase: Phase;
  status: RunStatus;
  durationMs: number;
  endsAt: number | null;
  remainingMs: number;
  /** abgeschlossene Lernphasen seit der letzten langen Pause */
  cycle: number;
  moduleId: ID | null;
  taskId: ID | null;
  phaseStartedAt: number | null;
  focusedMs: number;
  runningSince: number | null;
  /** Session, zu der gerade die Reflexion angezeigt wird */
  reflectionId: ID | null;
  mini: boolean;
  lastEnd: PhaseEndInfo | null;
  /** zuletzt beendeter Durchgang ist komplett (bis zum nächsten Start) */
  roundComplete: boolean;

  start(): void;
  pause(): void;
  resume(): void;
  toggle(): void;
  skip(): void;
  stop(): void;
  finishPhase(natural: boolean): void;
  setPhase(p: Phase): void;
  selectModule(id: ID | null): void;
  selectTask(id: ID | null): void;
  refreshDuration(): void;
  closeReflection(): void;
  setMini(v: boolean): void;
  /** Beim Beenden der App: laufende Lernzeit noch erfassen */
  captureForQuit(): void;
}

export function phaseMinutes(phase: Phase): number {
  const t = useData.getState().data.settings.timer;
  return phase === "focus" ? t.focus : phase === "short" ? t.shortBreak : t.longBreak;
}

function focusedNow(s: Pick<TimerState, "focusedMs" | "runningSince">, now = Date.now()) {
  return s.focusedMs + (s.runningSince ? now - s.runningSince : 0);
}

function recordSession(s: TimerState, now: number, completed: boolean): ID | null {
  const focused = focusedNow(s, now);
  if (!completed && focused < MIN_PARTIAL_MS) return null;
  const session: Session = {
    id: uid(),
    moduleId: s.moduleId,
    taskId: s.taskId,
    start: new Date(s.phaseStartedAt ?? now - focused).toISOString(),
    end: new Date(now).toISOString(),
    focusMinutes: Math.round((focused / MINUTE) * 10) / 10,
    plannedMinutes: Math.round(s.durationMs / MINUTE),
    completed,
  };
  useData.getState().upsert("sessions", session);
  return session.id;
}

export const useTimer = create<TimerState>()((set, get) => ({
  phase: "focus",
  status: "idle",
  durationMs: 50 * MINUTE,
  endsAt: null,
  remainingMs: 50 * MINUTE,
  cycle: 0,
  moduleId: null,
  taskId: null,
  phaseStartedAt: null,
  focusedMs: 0,
  runningSince: null,
  reflectionId: null,
  mini: false,
  lastEnd: null,
  roundComplete: false,

  start() {
    const s = get();
    if (s.status === "running") return;
    if (s.status === "paused") return get().resume();
    const now = Date.now();
    set({
      status: "running",
      endsAt: now + s.remainingMs,
      phaseStartedAt: now,
      runningSince: now,
      focusedMs: 0,
      roundComplete: false,
    });
  },

  pause() {
    const s = get();
    if (s.status !== "running" || !s.endsAt) return;
    const now = Date.now();
    set({
      status: "paused",
      remainingMs: Math.max(0, s.endsAt - now),
      focusedMs: focusedNow(s, now),
      runningSince: null,
      endsAt: null,
    });
  },

  resume() {
    const s = get();
    if (s.status !== "paused") return;
    const now = Date.now();
    set({ status: "running", endsAt: now + s.remainingMs, runningSince: now });
  },

  toggle() {
    const s = get();
    if (s.status === "running") s.pause();
    else if (s.status === "paused") s.resume();
    else s.start();
  },

  skip() {
    get().finishPhase(false);
  },

  stop() {
    const s = get();
    const now = Date.now();
    if (s.phase === "focus" && s.status !== "idle") recordSession(s, now, false);
    const dur = phaseMinutes("focus") * MINUTE;
    // „Beenden“ beendet den ganzen Durchgang – der nächste Start beginnt bei Einheit 1
    set({
      phase: "focus",
      status: "idle",
      cycle: 0,
      roundComplete: false,
      durationMs: dur,
      remainingMs: dur,
      endsAt: null,
      phaseStartedAt: null,
      focusedMs: 0,
      runningSince: null,
    });
  },

  finishPhase(natural) {
    const s = get();
    const now = Date.now();
    const settings = useData.getState().data.settings.timer;
    let sessionId: ID | null = null;
    let cycle = s.cycle;

    if (s.phase === "focus") {
      const focused = focusedNow(s, now);
      const counts = natural || focused >= s.durationMs * 0.8;
      if (s.status !== "idle" || natural) sessionId = recordSession(s, now, counts);
      if (counts) cycle += 1;
    }
    const step = planNext(s.phase, cycle, settings);

    const dur = phaseMinutes(step.next) * MINUTE;
    const reflect = natural && s.phase === "focus" && settings.reflection && sessionId !== null;
    set({
      phase: step.next,
      cycle: step.cycle,
      durationMs: dur,
      remainingMs: dur,
      status: step.autoStart ? "running" : "idle",
      endsAt: step.autoStart ? now + dur : null,
      phaseStartedAt: step.autoStart ? now : null,
      runningSince: step.autoStart ? now : null,
      focusedMs: 0,
      reflectionId: reflect ? sessionId : s.reflectionId,
      roundComplete: step.roundComplete,
      lastEnd: { from: s.phase, to: step.next, natural, sessionId, roundComplete: step.roundComplete },
    });
  },

  setPhase(p) {
    const s = get();
    if (s.status !== "idle") return;
    const dur = phaseMinutes(p) * MINUTE;
    set({ phase: p, durationMs: dur, remainingMs: dur });
  },

  selectModule(id) {
    const s = get();
    const task = s.taskId ? useData.getState().data.tasks.find((t) => t.id === s.taskId) : null;
    set({ moduleId: id, taskId: task && task.moduleId === id ? s.taskId : null });
  },

  selectTask(id) {
    const task = id ? useData.getState().data.tasks.find((t) => t.id === id) : null;
    set(task ? { taskId: id, moduleId: task.moduleId ?? get().moduleId } : { taskId: null });
  },

  refreshDuration() {
    const s = get();
    if (s.status !== "idle") return;
    const dur = phaseMinutes(s.phase) * MINUTE;
    set({ durationMs: dur, remainingMs: dur });
  },

  closeReflection() {
    set({ reflectionId: null });
  },

  setMini(v) {
    set({ mini: v });
  },

  captureForQuit() {
    const s = get();
    if (s.phase === "focus" && s.status !== "idle") {
      recordSession(s, Date.now(), false);
      set({ status: "idle", endsAt: null, runningSince: null, focusedMs: 0 });
    }
  },
}));

export function remainingNow(s: Pick<TimerState, "status" | "endsAt" | "remainingMs">, now = Date.now()) {
  return s.status === "running" && s.endsAt ? Math.max(0, s.endsAt - now) : s.remainingMs;
}

/** Leertaste startet/pausiert den Timer, solange kein Eingabefeld aktiv ist. */
export function spaceToggleHandler(e: KeyboardEvent) {
  if (e.code !== "Space" || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  const el = e.target as HTMLElement | null;
  if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName))) return;
  if (document.querySelector(".modal-backdrop")) return;
  e.preventDefault();
  useTimer.getState().toggle();
}

/**
 * Uhrzeit, zu der die letzte Lerneinheit des Durchgangs endet (null, wenn der
 * Durchgang ohne Ende läuft oder die Phasen nicht automatisch weiterlaufen).
 */
export function roundFinishAt(
  s: Pick<TimerState, "phase" | "status" | "cycle" | "endsAt" | "remainingMs">,
  t: TimerSettings,
  now = Date.now(),
): number | null {
  const units = t.longEvery;
  if (units <= 0 || !t.autoContinue || s.phase === "long") return null;
  const rem = remainingNow(s, now);
  const focus = t.focus * MINUTE;
  const short = t.shortBreak * MINUTE;
  if (s.phase === "focus") {
    const left = Math.max(0, units - (s.cycle + 1));
    return now + rem + left * (short + focus);
  }
  const left = Math.max(0, units - s.cycle);
  if (left === 0) return null;
  return now + rem + left * focus + (left - 1) * short;
}
