import { useMemo, useState } from "react";
import { CalendarCheck, GraduationCap, Plus, Trash2, Wand2 } from "lucide-react";
import { Empty, RoundCheck, Stepper, confirmDanger, toast } from "../../components/ui";
import { uid } from "../../lib/ids";
import { WEEK_ORDER, WEEKDAYS_SHORT, daysBetween, fmtDate, fmtDuration, parseLocal, todayStr, toDateStr } from "../../lib/time";
import { useData, useSettings } from "../../store/data";
import type { CalEvent, Chapter, ExamPlan, ExamPlanSettings, Module } from "../../store/types";
import { defaultPlanSettings, generatePlan, type PlanResult } from "./planner";

export function ExamPlanner({ module }: { module: Module }) {
  const focus = useSettings().timer.focus;
  const stored = useData((s) => s.data.examPlans.find((p) => p.moduleId === module.id));
  const events = useData((s) => s.data.events);
  const upsert = useData((s) => s.upsert);
  const setCollection = useData((s) => s.setCollection);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [bulk, setBulk] = useState("");
  const [newChapter, setNewChapter] = useState("");

  const plan: ExamPlan = stored ?? { id: uid(), moduleId: module.id, chapters: [], settings: defaultPlanSettings(focus) };
  const scheduled = useMemo(() => events.filter((e) => e.source?.planId === plan.id), [events, plan.id]);
  const futureScheduled = scheduled.filter((e) => e.start >= todayStr());

  const save = (next: Partial<ExamPlan>) => {
    upsert("examPlans", { ...plan, ...next });
    setResult(null);
  };
  const setSettings = (patch: Partial<ExamPlanSettings>) => save({ settings: { ...plan.settings, ...patch } });
  const setChapter = (id: string, patch: Partial<Chapter>) =>
    save({ chapters: plan.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const addChapters = (titles: string[]) => {
    const clean = titles.map((t) => t.trim()).filter(Boolean);
    if (!clean.length) return;
    save({ chapters: [...plan.chapters, ...clean.map((title) => ({ id: uid(), title, blocks: 2, done: false }))] });
  };

  if (!module.examDate) {
    return (
      <Empty
        icon={<GraduationCap size={20} />}
        title="Kein Klausurtermin eingetragen"
        text="Trage im Reiter „Allgemein“ das Klausurdatum ein. Danach kannst du deine Kapitel hier auf die Zeit bis zur Klausur verteilen."
      />
    );
  }

  const daysLeft = daysBetween(todayStr(), module.examDate);
  const openBlocks = plan.chapters.filter((c) => !c.done).reduce((a, c) => a + c.blocks, 0);
  const s = plan.settings;

  const compute = () => {
    const res = generatePlan({
      plan,
      moduleLabel: module.short || module.name,
      examDate: module.examDate!,
      events,
      now: new Date(),
    });
    setResult(res);
  };

  const apply = () => {
    if (!result) return;
    const today = todayStr();
    const keep = events.filter((e) => !(e.source?.planId === plan.id && e.start >= today));
    const created: CalEvent[] = result.blocks.map((b) => ({
      id: uid(),
      title: b.title,
      type: "study",
      start: `${b.date}T${b.start}`,
      end: `${b.date}T${b.end}`,
      allDay: false,
      moduleId: module.id,
      source: { kind: "planner", planId: plan.id, chapterId: b.chapterId ?? undefined },
    }));
    setCollection("events", [...keep, ...created]);
    upsert("examPlans", { ...plan, generatedAt: new Date().toISOString() });
    setResult(null);
    toast(`${created.length} Lernblöcke in den Kalender eingetragen.`, "success");
  };

  const clearScheduled = async () => {
    if (!(await confirmDanger("Geplante Lernblöcke entfernen?", `${futureScheduled.length} zukünftige Blöcke dieses Plans werden aus dem Kalender gelöscht.`, "Entfernen")))
      return;
    const today = todayStr();
    setCollection(
      "events",
      events.filter((e) => !(e.source?.planId === plan.id && e.start >= today)),
    );
  };

  return (
    <div className="col gap-16">
      <div className="banner info">
        <GraduationCap size={16} />
        <span>
          Klausur am <strong>{fmtDate(module.examDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong> –
          noch {daysLeft} Tage. {openBlocks > 0 && `${openBlocks} Blöcke offen (≈ ${fmtDuration(openBlocks * s.blockMinutes)}).`}
        </span>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="col gap-8">
          <h3>Kapitel &amp; Aufwand</h3>
          <p className="tiny faint">Schätze pro Kapitel, wie viele Lernblöcke (Pomodoros) du brauchst.</p>
          <div className="list">
            {plan.chapters.map((c) => (
              <div key={c.id} className={`list-item task-row ${c.done ? "is-done" : ""}`}>
                <RoundCheck on={c.done} onClick={() => setChapter(c.id, { done: !c.done })} />
                <input
                  className="input bare grow task-title"
                  value={c.title}
                  onChange={(e) => setChapter(c.id, { title: e.target.value })}
                />
                <Stepper size="sm" value={c.blocks} min={0} max={40} onChange={(v) => setChapter(c.id, { blocks: v })} />
                <button className="icon-btn sm" onClick={() => save({ chapters: plan.chapters.filter((x) => x.id !== c.id) })} title="Entfernen">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="quick-add">
            <Plus size={16} className="faint" />
            <input
              className="input bare grow"
              placeholder="Kapitel hinzufügen …"
              value={newChapter}
              onChange={(e) => setNewChapter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addChapters([newChapter]);
                  setNewChapter("");
                }
              }}
            />
          </div>
          <details className="small">
            <summary className="faint" style={{ cursor: "pointer" }}>
              Mehrere Kapitel auf einmal einfügen (z. B. aus der Gliederung)
            </summary>
            <textarea
              className="textarea mt-8"
              placeholder={"Eine Zeile pro Kapitel, z. B.\n1 Grundlagen der Investitionsrechnung\n2 Kapitalkosten und WACC"}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
            />
            <button
              className="btn sm mt-8"
              onClick={() => {
                addChapters(bulk.split("\n"));
                setBulk("");
              }}
            >
              Übernehmen
            </button>
          </details>
        </div>

        <div className="col gap-12">
          <h3>Wann willst du lernen?</h3>
          <div className="field">
            <span className="field-label">Lerntage</span>
            <div className="row gap-4 wrap">
              {WEEK_ORDER.map((d) => (
                <button
                  key={d}
                  className={`chip ${s.days.includes(d) ? "active" : ""}`}
                  onClick={() => setSettings({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] })}
                >
                  {WEEKDAYS_SHORT[d]}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Frühester Beginn</label>
              <input type="time" className="input" value={s.dayStart} onChange={(e) => setSettings({ dayStart: e.target.value })} />
            </div>
            <div className="field">
              <label>Spätestes Ende</label>
              <input type="time" className="input" value={s.dayEnd} onChange={(e) => setSettings({ dayEnd: e.target.value })} />
            </div>
            <div className="field">
              <span className="field-label">Blocklänge</span>
              <Stepper value={s.blockMinutes} min={15} max={180} step={5} suffix=" min" onChange={(v) => setSettings({ blockMinutes: v })} />
            </div>
            <div className="field">
              <span className="field-label">Pause dazwischen</span>
              <Stepper value={s.breakMinutes} min={0} max={60} step={5} suffix=" min" onChange={(v) => setSettings({ breakMinutes: v })} />
            </div>
            <div className="field">
              <span className="field-label">Max. Blöcke pro Tag</span>
              <Stepper value={s.maxBlocksPerDay} min={1} max={10} onChange={(v) => setSettings({ maxBlocksPerDay: v })} />
            </div>
            <div className="field">
              <label>Planung ab</label>
              <input
                type="date"
                className="input"
                value={s.startDate ?? ""}
                onChange={(e) => setSettings({ startDate: e.target.value || undefined })}
              />
            </div>
            <div className="field">
              <span className="field-label">Wiederholungstage vor der Klausur</span>
              <Stepper value={s.reviewDays} min={0} max={21} onChange={(v) => setSettings({ reviewDays: v })} />
            </div>
            <div className="field">
              <span className="field-label">Wiederholungsblöcke</span>
              <Stepper value={s.reviewBlocks} min={0} max={40} onChange={(v) => setSettings({ reviewBlocks: v })} />
            </div>
          </div>
          <p className="tiny faint">Bestehende Termine wie Vorlesungen werden automatisch ausgespart.</p>
        </div>
      </div>

      <div className="row wrap">
        <button className="btn primary" onClick={compute} disabled={!openBlocks && !s.reviewBlocks}>
          <Wand2 size={15} /> Plan berechnen
        </button>
        {futureScheduled.length > 0 && (
          <>
            <span className="small muted">
              {futureScheduled.length} geplante Blöcke im Kalender
              {plan.generatedAt && ` (erstellt am ${fmtDate(toDateStr(new Date(plan.generatedAt)), { day: "numeric", month: "short" })})`}
            </span>
            <button className="btn ghost danger sm" onClick={() => void clearScheduled()}>
              Entfernen
            </button>
          </>
        )}
      </div>

      {result && <PlanPreview result={result} onApply={apply} replaces={futureScheduled.length} />}
    </div>
  );
}

function PlanPreview({ result, onApply, replaces }: { result: PlanResult; onApply: () => void; replaces: number }) {
  const byDay = new Map<string, PlanResult["blocks"]>();
  for (const b of result.blocks) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);

  return (
    <div className="card flat">
      <div className="card-header">
        <h3>
          <CalendarCheck size={16} /> Vorschlag: {result.blocks.length} Lernblöcke an {byDay.size} Tagen
        </h3>
        <button className="btn primary sm" onClick={onApply} disabled={!result.blocks.length}>
          In Kalender übernehmen
        </button>
      </div>
      {result.missing > 0 && (
        <div className="banner mb-16">
          Es passen nur {result.needed - result.missing} von {result.needed} Kapitelblöcken in den Zeitraum. Erlaube mehr Blöcke pro Tag,
          weitere Lerntage oder ein größeres Zeitfenster.
        </div>
      )}
      {replaces > 0 && <p className="tiny faint mb-16">Die {replaces} bisher geplanten zukünftigen Blöcke werden dabei ersetzt.</p>}
      <div className="plan-preview">
        {[...byDay.entries()].map(([date, blocks]) => (
          <div key={date} className="plan-day">
            <span className="plan-date">{parseLocal(date).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })}</span>
            <div className="col gap-4">
              {blocks.map((b, i) => (
                <span key={i} className={`plan-block ${b.kind}`}>
                  <span className="tabular faint">
                    {b.start}–{b.end}
                  </span>{" "}
                  {b.title.replace(/^[^:]+: /, "")}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
