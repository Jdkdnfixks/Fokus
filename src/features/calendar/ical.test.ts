import { describe, expect, it } from "vitest";
import { parseIcal } from "./ical";
import type { Module } from "../../store/types";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:vl-cf@rub
DTSTART;TZID=Europe/Berlin:20261012T101500
DTEND;TZID=Europe/Berlin:20261012T114500
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=Europe/Berlin:20261019T101500
SUMMARY:Vorlesung Corporate Finance
LOCATION:HGA 20
END:VEVENT
BEGIN:VEVENT
UID:vl-cf@rub
RECURRENCE-ID;TZID=Europe/Berlin:20261026T101500
DTSTART;TZID=Europe/Berlin:20261026T121500
DTEND;TZID=Europe/Berlin:20261026T134500
SUMMARY:Vorlesung Corporate Finance (verlegt)
END:VEVENT
BEGIN:VEVENT
UID:ue-ifrs@rub
DTSTART;TZID=Europe/Berlin:20261014T141500
DTEND;TZID=Europe/Berlin:20261014T154500
SUMMARY:Übung IFRS
END:VEVENT
END:VCALENDAR`;

const modules: Module[] = [
  { id: "m1", name: "Corporate Finance", color: "#000", weeklyGoalMinutes: 0, archived: false, createdAt: "" },
  { id: "m2", name: "International Accounting", short: "IFRS", color: "#000", weeklyGoalMinutes: 0, archived: false, createdAt: "" },
];

describe("parseIcal", () => {
  it("löst Serien, Ausnahmen und Verlegungen auf", () => {
    const res = parseIcal(ICS, {
      type: "lecture",
      moduleId: null,
      autoModule: true,
      modules,
      feed: "test",
      from: new Date(2026, 9, 1),
      until: new Date(2027, 2, 1),
    });
    const cf = res.events.filter((e) => e.title.startsWith("Vorlesung"));
    expect(cf.map((e) => e.start)).toEqual(["2026-10-12T10:15", "2026-10-26T12:15", "2026-11-02T10:15"]);
    expect(cf[0].moduleId).toBe("m1");
    expect(cf[0].location).toBe("HGA 20");
    const ue = res.events.find((e) => e.title === "Übung IFRS");
    expect(ue?.type).toBe("exercise");
    expect(ue?.moduleId).toBe("m2");
  });
});
