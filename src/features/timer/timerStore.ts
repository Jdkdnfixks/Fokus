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
    set({
      phase: "focus",
      status: "idle",
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
    let next: Phase;
    let cycle = s.cycle;
    let autoStart: boolean;

    if (s.phase === "focus") {
      const focused = focusedNow(s, now);
      const counts = natural || focused >= s.durationMs * 0.8;
      if (s.status !== "idle" || natural) sessionId = recordSession(s, now, counts);
      if (counts) cycle += 1;
      next = settings.longEvery > 0 && cycle >= settings.longEvery ? "long" : "short";
      autoStart = settings.autoStartBreak;
    } else {
      if (s.phase === "long") cycle = 0;
      next = "focus";
      autoStart = settings.autoStartFocus;
    }

    const dur = phaseMinutes(next) * MINUTE;
    const reflect = natural && s.phase === "focus" && settings.reflection && sessionId !== null;
    set({
      phase: next,
      cycle,
      durationMs: dur,
      remainingMs: dur,
      status: autoStart ? "running" : "idle",
      endsAt: autoStart ? now + dur : null,
      phaseStartedAt: autoStart ? now : null,
      runningSince: autoStart ? now : null,
      focusedMs: 0,
      reflectionId: reflect ? sessionId : s.reflectionId,
      lastEnd: { from: s.phase, to: next, natural, sessionId },
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
