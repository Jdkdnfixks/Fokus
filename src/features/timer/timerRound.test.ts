import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

const { useData } = await import("../../store/data");
const { useTimer, planNext, roundFinishAt } = await import("./timerStore");

function timerSettings(patch: Partial<ReturnType<typeof useData.getState>["data"]["settings"]["timer"]>) {
  useData.setState((s) => ({
    data: { ...s.data, settings: { ...s.data.settings, timer: { ...s.data.settings.timer, ...patch } } },
  }));
  useTimer.setState({ cycle: 0, roundComplete: false });
  useTimer.getState().stop();
}

describe("Durchgang mit mehreren Einheiten", () => {
  beforeEach(() => timerSettings({ focus: 60, shortBreak: 10, longEvery: 3, longBreak: 0, autoContinue: true }));

  it("60/10 × 3: läuft automatisch durch alle Phasen und stoppt nach der 3. Einheit", () => {
    const t = () => useTimer.getState();
    t().start();
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      expect(t().status).toBe("running");
      seen.push(`${t().phase}${t().phase === "focus" ? t().cycle + 1 : ""}`);
      t().finishPhase(true);
    }
    expect(seen).toEqual(["focus1", "short", "focus2", "short", "focus3"]);
    // nach der 3. Einheit: Timer wartet, Durchgang geschafft
    expect(t().status).toBe("idle");
    expect(t().phase).toBe("focus");
    expect(t().cycle).toBe(0);
    expect(t().roundComplete).toBe(true);
    expect(t().lastEnd?.roundComplete).toBe(true);
    // neuer Start setzt die Meldung zurück
    t().start();
    expect(t().roundComplete).toBe(false);
  });

  it("mit langer Pause am Ende: nach der letzten Einheit lange Pause, danach Stopp", () => {
    timerSettings({ longEvery: 2, longBreak: 30 });
    const t = () => useTimer.getState();
    t().start();
    t().finishPhase(true); // Einheit 1 → kurze Pause
    t().finishPhase(true); // → Einheit 2
    t().finishPhase(true); // Einheit 2 fertig → lange Pause
    expect(t().phase).toBe("long");
    expect(t().status).toBe("running");
    expect(t().durationMs).toBe(30 * 60_000);
    t().finishPhase(true); // lange Pause vorbei → Stopp
    expect(t().status).toBe("idle");
    expect(t().roundComplete).toBe(true);
  });

  it("„∞“ (0 Einheiten) läuft ohne Ende weiter", () => {
    timerSettings({ longEvery: 0 });
    const t = () => useTimer.getState();
    t().start();
    for (let i = 0; i < 10; i++) {
      t().finishPhase(true);
      expect(t().status).toBe("running");
    }
  });

  it("ohne automatischen Ablauf wartet der Timer nach jeder Phase", () => {
    timerSettings({ autoContinue: false });
    const t = () => useTimer.getState();
    t().start();
    t().finishPhase(true);
    expect(t().phase).toBe("short");
    expect(t().status).toBe("idle");
  });

  it("zeigt, wann die letzte Einheit endet", () => {
    const now = 1_000_000;
    // Einheit 1 läuft, noch 60 Min → + 2 × (10 + 60) Min
    const s = { phase: "focus" as const, status: "running" as const, cycle: 0, endsAt: now + 60 * 60_000, remainingMs: 0 };
    expect(roundFinishAt(s, useData.getState().data.settings.timer, now)).toBe(now + (60 + 2 * 70) * 60_000);
  });

  it("planNext kennt das Ende des Durchgangs", () => {
    const set = { ...useData.getState().data.settings.timer, longEvery: 3, longBreak: 0, autoContinue: true };
    expect(planNext("focus", 2, set)).toMatchObject({ next: "short", autoStart: true });
    expect(planNext("focus", 3, set)).toMatchObject({ next: "focus", autoStart: false, roundComplete: true, cycle: 0 });
    expect(planNext("short", 2, set)).toMatchObject({ next: "focus", autoStart: true });
  });
});
