import { describe, expect, it } from "vitest";
import { generatePlan, spread } from "./planner";
import type { CalEvent, ExamPlan } from "../../store/types";

const plan: ExamPlan = {
  id: "p1",
  moduleId: "m1",
  chapters: [
    { id: "c1", title: "Kapitel 1", blocks: 2, done: false },
    { id: "c2", title: "Kapitel 2", blocks: 3, done: false },
    { id: "c3", title: "Kapitel 3", blocks: 1, done: true },
  ],
  settings: {
    blockMinutes: 50,
    breakMinutes: 10,
    maxBlocksPerDay: 2,
    days: [1, 2, 3, 4, 5],
    dayStart: "09:00",
    dayEnd: "12:00",
    reviewDays: 2,
    reviewBlocks: 2,
  },
};

describe("spread", () => {
  it("verteilt gleichmäßig", () => {
    expect(spread([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8]);
    expect(spread([1, 2], 5)).toEqual([1, 2]);
  });
});

describe("generatePlan", () => {
  const now = new Date(2026, 9, 5, 8, 0); // Mo 05.10.2026, 8 Uhr

  it("plant Kapitelblöcke vor den Wiederholungstagen", () => {
    const res = generatePlan({ plan, moduleLabel: "CF", examDate: "2026-10-16", events: [], now });
    const chapters = res.blocks.filter((b) => b.kind === "chapter");
    const review = res.blocks.filter((b) => b.kind === "review");
    expect(chapters).toHaveLength(5);
    expect(res.missing).toBe(0);
    // Wiederholung nur am 14. und 15. (die zwei Tage vor der Klausur)
    for (const r of review) expect(["2026-10-14", "2026-10-15"]).toContain(r.date);
    for (const c of chapters) expect(c.date < "2026-10-14").toBe(true);
    // Kapitel in der richtigen Reihenfolge
    expect(chapters[0].title).toBe("CF: Kapitel 1 (1/2)");
    expect(chapters[4].title).toBe("CF: Kapitel 2 (3/3)");
  });

  it("weicht belegten Terminen aus", () => {
    const lecture: CalEvent = {
      id: "e1",
      title: "Vorlesung",
      type: "lecture",
      start: "2026-10-05T09:00",
      end: "2026-10-05T10:30",
      allDay: false,
      moduleId: null,
      recurrence: { freq: "weekly", interval: 1 },
    };
    const res = generatePlan({ plan, moduleLabel: "CF", examDate: "2026-10-16", events: [lecture], now });
    for (const b of res.blocks.filter((x) => x.date === "2026-10-05" || x.date === "2026-10-12")) {
      expect(b.start >= "10:30").toBe(true);
    }
  });

  it("meldet fehlende Kapazität", () => {
    const res = generatePlan({ plan, moduleLabel: "CF", examDate: "2026-10-08", events: [], now });
    expect(res.missing).toBeGreaterThan(0);
  });
});
