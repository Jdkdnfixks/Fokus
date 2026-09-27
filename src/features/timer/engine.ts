import { notify } from "../../lib/notify";
import { audioContext } from "../../lib/audio";
import { playChime, scheduleTick } from "../../lib/sounds";
import { callOr, onBackendEvent } from "../../lib/tauri";
import { useData } from "../../store/data";
import { onPhaseEnding, startCoupling } from "./coupling";
import { PHASE_LABEL, remainingNow, useTimer, type PhaseEndInfo } from "./timerStore";
import { setMiniMode } from "./mini";

let started = false;

/** So viele ms vor Phasenende werden die Countdown-Töne geplant */
const COUNTDOWN_LEAD = 6000;
const COUNTDOWN_TICKS = 5;

/** Zeitmarken vor Phasenende: Countdown und Beginn der Musik-Überblendung */
function marks(): number[] {
  const fadeMs = Math.round(useData.getState().data.settings.music.fadeSeconds * 1000);
  return [...new Set([COUNTDOWN_LEAD, fadeMs].filter((m) => m > 0))];
}

const firedMarks = new Set<string>();
let countdown: { endsAt: number; nodes: AudioScheduledSourceNode[] } | null = null;

function cancelCountdown() {
  if (!countdown) return;
  for (const n of countdown.nodes) {
    try {
      n.stop();
    } catch {
      /* schon beendet */
    }
  }
  countdown = null;
}

/** Plant einen Ton für jede der letzten 5 Sekunden (5, 4, 3, 2, 1). */
function scheduleCountdown(endsAt: number) {
  const t = useData.getState().data.settings.timer;
  if (!t.countdownTicks || t.sound === "aus" || t.soundVolume <= 0) return;
  if (countdown?.endsAt === endsAt) return;
  cancelCountdown();
  const ac = audioContext();
  const now = Date.now();
  const nodes: AudioScheduledSourceNode[] = [];
  for (let i = COUNTDOWN_TICKS; i >= 1; i--) {
    const at = endsAt - i * 1000;
    if (at < now - 100) continue;
    nodes.push(scheduleTick(ac, ac.currentTime + Math.max(0, (at - now) / 1000), t.sound, t.soundVolume, i === 1));
  }
  countdown = { endsAt, nodes };
}

/** Eine Zeitmarke vor Phasenende ist erreicht (vom Backend oder der Prüfschleife). */
function handleMark(endsAt: number, before: number) {
  const s = useTimer.getState();
  if (s.status !== "running" || s.endsAt !== endsAt) return;
  const key = `${endsAt}:${before}`;
  if (firedMarks.has(key)) return;
  firedMarks.add(key);
  if (before === COUNTDOWN_LEAD) scheduleCountdown(endsAt);
  if (before === Math.round(useData.getState().data.settings.music.fadeSeconds * 1000)) void onPhaseEnding();
}

function check() {
  const s = useTimer.getState();
  if (s.status !== "running" || !s.endsAt) return;
  const remaining = s.endsAt - Date.now();
  for (const m of marks()) if (remaining <= m) handleMark(s.endsAt, m);
  if (remaining <= 250) s.finishPhase(true);
}

function syncBackend() {
  const s = useTimer.getState();
  void callOr(
    "timer_sync",
    {
      display: {
        label: PHASE_LABEL[s.phase],
        running: s.status === "running",
        endsAtMs: s.endsAt ?? 0,
        remainingMs: remainingNow(s),
        totalMs: s.durationMs,
        active: s.status !== "idle",
      },
      marks: marks(),
    },
    undefined,
  ).catch(() => {});
}

function onPhaseEnd(info: PhaseEndInfo) {
  if (!info.natural) return;
  const t = useData.getState().data.settings.timer;
  const timer = useTimer.getState();
  playChime(t.sound, t.soundVolume, info.from === "focus" && !info.roundComplete ? "down" : "up");
  if (!t.notifications) return;

  const units = t.longEvery;
  if (info.roundComplete) {
    void notify(
      "Durchgang geschafft!",
      units > 0
        ? `${units} ${units === 1 ? "Lerneinheit" : "Lerneinheiten"} à ${t.focus} Min erledigt. Starte den nächsten Durchgang, wenn du bereit bist.`
        : "Starte den nächsten Durchgang, wenn du bereit bist.",
    );
    return;
  }
  const running = timer.status === "running";
  if (info.from === "focus") {
    const mins = info.to === "long" ? t.longBreak : t.shortBreak;
    const unitText = units > 0 ? ` (Einheit ${timer.cycle} von ${units})` : "";
    void notify(
      `Lernphase geschafft${unitText}`,
      info.to === "long"
        ? `Letzte Einheit geschafft – jetzt ${mins} Min lange Pause.`
        : running
          ? `Kurze Pause: ${mins} Min. Steh kurz auf und trink etwas.`
          : `Starte die Pause (${mins} Min), wenn du so weit bist.`,
    );
  } else {
    const unitText = units > 0 ? ` – Einheit ${timer.cycle + 1} von ${units}` : "";
    void notify(
      "Pause vorbei",
      running ? `Die nächste Lernphase (${t.focus} Min) läuft${unitText}.` : `Starte die nächste Lernphase (${t.focus} Min), wenn du bereit bist.`,
    );
  }
}

export function startTimerEngine() {
  if (started) return;
  started = true;

  setInterval(check, 500);
  void onBackendEvent("timer://alarm", check);
  void onBackendEvent<{ endsAtMs: number; before: number }>("timer://mark", (p) => handleMark(p.endsAtMs, p.before));
  void onBackendEvent("tray://toggle", () => useTimer.getState().toggle());
  void onBackendEvent("tray://skip", () => useTimer.getState().skip());
  void onBackendEvent("tray://mini", () => void setMiniMode(true));

  useTimer.subscribe((s, prev) => {
    if (s.status !== prev.status || s.endsAt !== prev.endsAt || s.phase !== prev.phase || s.durationMs !== prev.durationMs) {
      syncBackend();
    }
    if (s.endsAt !== prev.endsAt || s.status !== "running") {
      firedMarks.clear();
      if (countdown && (s.status !== "running" || countdown.endsAt !== s.endsAt)) cancelCountdown();
    }
    if (s.lastEnd && s.lastEnd !== prev.lastEnd) onPhaseEnd(s.lastEnd);
  });

  // geänderte Timer-Einstellungen übernehmen, solange nichts läuft
  useData.subscribe((d, prev) => {
    if (d.data.settings.timer !== prev.data.settings.timer) useTimer.getState().refreshDuration();
  });

  useTimer.getState().refreshDuration();
  syncBackend();
  startCoupling();
}
