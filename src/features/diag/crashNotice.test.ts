import { describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

const { analyzeReport, reportText } = await import("./crashNotice");

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const ev = (sec: number, text: string) => ({ at: T + sec * 1000, text });

describe("Absturz-Erkennung", () => {
  it("erkennt den Website-Blocker kurz vor dem Ende", () => {
    const r = analyzeReport({
      version: "0.2.12",
      startedAt: T,
      lastAlive: T + 40_000,
      events: [ev(5, "Timer: Lernphase läuft (noch 25:00)"), ev(5, "Website-Blocker: hosts-Datei wird geschrieben (8 Seiten)"), ev(5, "Website-Blocker: hosts-Datei geschrieben")],
    });
    expect(r.cause).toBe("blocker");
    expect(r.recent).toHaveLength(3);
  });

  it("erkennt eine Messung, die nicht fertig wurde", () => {
    const r = analyzeReport({
      version: "0.2.12",
      startedAt: T,
      lastAlive: T + 30_000,
      events: [ev(4, "Lautstärke messen: a.mp3"), ev(9, "Lautstärke gemessen: a.mp3"), ev(9, "Lautstärke messen: b.mp3")],
      panic: "index out of bounds",
    });
    expect(r.cause).toBe("measure");
    expect(r.measuringFile).toBe("b.mp3");
  });

  it("Blocker lange vorher gilt nicht als Ursache", () => {
    const r = analyzeReport({
      version: "0.2.12",
      startedAt: T,
      lastAlive: T + 30 * 60_000,
      events: [ev(5, "Website-Blocker: hosts-Datei geschrieben"), ev(1500, "Timer: Kurze Pause läuft (noch 05:00)")],
    });
    expect(r.cause).toBe("unknown");
  });

  it("meldet Programmfehler mit Ort", () => {
    const report = { version: "0.2.12", startedAt: T, lastAlive: T + 1000, events: [ev(1, "Timer: aus")], panic: "Fehler (src/x.rs:1)" };
    expect(analyzeReport(report).cause).toBe("panic");
    expect(reportText(report)).toContain("Fehler: Fehler (src/x.rs:1)");
    expect(reportText(report)).toContain("Timer: aus");
  });
});
