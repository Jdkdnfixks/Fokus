import { notify } from "../../lib/notify";
import { playChime } from "../../lib/sounds";
import { callOr, onBackendEvent } from "../../lib/tauri";
import { useData } from "../../store/data";
import { startCoupling } from "./coupling";
import { PHASE_LABEL, remainingNow, useTimer, type PhaseEndInfo } from "./timerStore";
import { setMiniMode } from "./mini";

let started = false;

function check() {
  const s = useTimer.getState();
  if (s.status === "running" && s.endsAt && Date.now() >= s.endsAt - 250) {
    s.finishPhase(true);
  }
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
    },
    undefined,
  ).catch(() => {});
}

function onPhaseEnd(info: PhaseEndInfo) {
  if (!info.natural) return;
  const t = useData.getState().data.settings.timer;
  playChime(t.sound, t.soundVolume, info.from === "focus" ? "down" : "up");
  if (!t.notifications) return;

  if (info.from === "focus") {
    const mins = info.to === "long" ? t.longBreak : t.shortBreak;
    void notify(
      "Lernphase geschafft",
      info.to === "long" ? `Zeit für eine lange Pause (${mins} Min). Gut gemacht!` : `Kurze Pause: ${mins} Min. Steh kurz auf und trink etwas.`,
    );
  } else {
    void notify(
      "Pause vorbei",
      t.autoStartFocus ? `Die nächste Lernphase (${t.focus} Min) läuft.` : `Starte die nächste Lernphase (${t.focus} Min), wenn du bereit bist.`,
    );
  }
}

export function startTimerEngine() {
  if (started) return;
  started = true;

  setInterval(check, 500);
  void onBackendEvent("timer://alarm", check);
  void onBackendEvent("tray://toggle", () => useTimer.getState().toggle());
  void onBackendEvent("tray://skip", () => useTimer.getState().skip());
  void onBackendEvent("tray://mini", () => void setMiniMode(true));

  useTimer.subscribe((s, prev) => {
    if (s.status !== prev.status || s.endsAt !== prev.endsAt || s.phase !== prev.phase || s.durationMs !== prev.durationMs) {
      syncBackend();
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
