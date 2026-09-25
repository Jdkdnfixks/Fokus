import { describe, expect, it } from "vitest";
import { expandEvents } from "./recurrence";
import type { CalEvent } from "../../store/types";

const base: CalEvent = {
  id: "e1",
  title: "Vorlesung",
  type: "lecture",
  start: "2026-10-12T10:15",
  end: "2026-10-12T11:45",
  allDay: false,
  moduleId: null,
};

describe("expandEvents", () => {
  it("liefert einzelne Termine im Zeitraum", () => {
    const res = expandEvents([base], new Date(2026, 9, 12), new Date(2026, 9, 13));
    expect(res).toHaveLength(1);
    expect(res[0].start.getHours()).toBe(10);
  });

  it("wiederholt wöchentlich bis zum Enddatum und lässt Ausnahmen aus", () => {
    const ev: CalEvent = {
      ...base,
      recurrence: { freq: "weekly", interval: 1, until: "2026-11-02" },
      exdates: ["2026-10-19"],
    };
    const res = expandEvents([ev], new Date(2026, 9, 1), new Date(2026, 11, 31));
    expect(res.map((r) => r.date)).toEqual(["2026-10-12", "2026-10-26", "2026-11-02"]);
  });

  it("unterstützt mehrere Wochentage und Intervalle", () => {
    const ev: CalEvent = { ...base, recurrence: { freq: "weekly", interval: 2, byDay: [1, 3] } };
    const res = expandEvents([ev], new Date(2026, 9, 12), new Date(2026, 9, 31));
    expect(res.map((r) => r.date)).toEqual(["2026-10-12", "2026-10-14", "2026-10-26", "2026-10-28"]);
  });

  it("behält die Uhrzeit über die Zeitumstellung hinweg", () => {
    const ev: CalEvent = { ...base, recurrence: { freq: "weekly", interval: 1 } };
    const res = expandEvents([ev], new Date(2026, 9, 20), new Date(2026, 10, 3));
    for (const r of res) expect(r.start.getHours()).toBe(10);
  });
});
