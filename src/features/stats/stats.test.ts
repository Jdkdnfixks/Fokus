import { describe, expect, it } from "vitest";
import { bestFocusWindow, currentStreak, longestStreak, todayMinutes, weekMinutes } from "./stats";
import type { Session } from "../../store/types";

function session(start: Date, minutes: number, rating?: number): Session {
  return {
    id: Math.random().toString(36),
    moduleId: null,
    taskId: null,
    start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60000).toISOString(),
    focusMinutes: minutes,
    plannedMinutes: minutes,
    completed: true,
    rating,
  };
}

const now = new Date(2026, 9, 14, 18, 0); // Mi, 14.10.2026

describe("Statistik", () => {
  it("summiert heute und diese Woche", () => {
    const s = [
      session(new Date(2026, 9, 14, 9), 50),
      session(new Date(2026, 9, 14, 11), 25),
      session(new Date(2026, 9, 12, 9), 50), // Montag
      session(new Date(2026, 9, 11, 9), 50), // Sonntag davor
    ];
    expect(todayMinutes(s, now)).toBe(75);
    expect(weekMinutes(s, now)).toBe(125);
  });

  it("zählt Serien", () => {
    const s = [
      session(new Date(2026, 9, 14, 9), 50),
      session(new Date(2026, 9, 13, 9), 50),
      session(new Date(2026, 9, 12, 9), 50),
      session(new Date(2026, 9, 10, 9), 50),
    ];
    expect(currentStreak(s, now)).toBe(3);
    expect(longestStreak(s)).toBe(3);
    // heute noch nichts gelernt → Serie bis gestern zählt weiter
    expect(currentStreak(s.slice(1), now)).toBe(2);
  });

  it("findet die konzentrierteste Tageszeit", () => {
    const s = [
      session(new Date(2026, 9, 12, 9), 50, 5),
      session(new Date(2026, 9, 13, 10), 50, 4),
      session(new Date(2026, 9, 14, 9), 50, 5),
      session(new Date(2026, 9, 14, 20), 50, 2),
      session(new Date(2026, 9, 13, 20), 50, 2),
      session(new Date(2026, 9, 12, 21), 50, 3),
    ];
    const best = bestFocusWindow(s);
    expect(best?.from).toBe(9);
  });
});
