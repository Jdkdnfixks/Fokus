import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, BookOpen, GraduationCap, Plus } from "lucide-react";
import { ColorPicker, Empty, Modal, ProgressBar, Stepper, confirmDanger } from "../../components/ui";
import { uid } from "../../lib/ids";
import { daysBetween, fmtDate, fmtHours, todayStr } from "../../lib/time";
import { MODULE_COLORS } from "../../store/defaults";
import { useData } from "../../store/data";
import { useNav } from "../../store/nav";
import type { CalEvent, Module } from "../../store/types";
import { minutesBetween, weekMinutes } from "../stats/stats";
import { ExamPlanner } from "./ExamPlanner";

export function ModulesPage() {
  const modules = useData((s) => s.data.modules);
  const tasks = useData((s) => s.data.tasks);
  const sessions = useData((s) => s.data.sessions);
  const focusId = useNav((s) => s.focusId);
  const [editing, setEditing] = useState<{ module: Module; tab: "general" | "plan"; isNew: boolean } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    const m = focusId ? modules.find((x) => x.id === focusId) : undefined;
    if (m) setEditing({ module: m, tab: "plan", isNew: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const active = modules.filter((m) => !m.archived);
  const archived = modules.filter((m) => m.archived);
  const ects = active.reduce((a, m) => a + (m.ects ?? 0), 0);

  const newModule = () => {
    // nächste freie Farbe in fester Reihenfolge; sind alle belegt, die am seltensten genutzte
    const used = modules.filter((m) => !m.archived).map((m) => m.color);
    const color =
      MODULE_COLORS.find((c) => !used.includes(c)) ??
      [...MODULE_COLORS].sort((a, b) => used.filter((u) => u === a).length - used.filter((u) => u === b).length)[0];
    setEditing({
      module: { id: uid(), name: "", color, weeklyGoalMinutes: 300, archived: false, createdAt: new Date().toISOString() },
      tab: "general",
      isNew: true,
    });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Module</h1>
          <p className="subtitle">
            {active.length} aktive Module{ects > 0 && ` · ${ects} ECTS`}
          </p>
        </div>
        <button className="btn primary" onClick={newModule}>
          <Plus size={16} /> Neues Modul
        </button>
      </div>

      {!active.length && (
        <div className="card">
          <Empty
            icon={<BookOpen size={20} />}
            title="Noch keine Module"
            text="Lege für jede Lehrveranstaltung ein Modul an. Aufgaben, Termine und Lernzeiten lassen sich dann zuordnen und auswerten."
            action={
              <button className="btn primary" onClick={newModule}>
                <Plus size={16} /> Erstes Modul anlegen
              </button>
            }
          />
        </div>
      )}

      <div className="grid auto">
        {active.map((m) => (
          <ModuleCard
            key={m.id}
            module={m}
            openTasks={tasks.filter((t) => t.moduleId === m.id && !t.done).length}
            weekMin={weekMinutes(sessions, new Date(), m.id)}
            totalMin={minutesBetween(sessions, new Date(0), new Date(8.64e15), m.id)}
            onOpen={(tab) => setEditing({ module: m, tab, isNew: false })}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <div className="mt-24">
          <button className="link-btn small" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Archiv ausblenden" : `Archiv anzeigen (${archived.length})`}
          </button>
          {showArchived && (
            <div className="list mt-8">
              {archived.map((m) => (
                <div key={m.id} className="list-item">
                  <span className="dot" style={{ background: m.color }} />
                  <span className="grow">{m.name}</span>
                  <button className="btn sm ghost" onClick={() => setEditing({ module: m, tab: "general", isNew: false })}>
                    Öffnen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <ModuleDialog
          initial={editing.module}
          initialTab={editing.tab}
          isNew={editing.isNew}
          onClose={() => {
            setEditing(null);
            useNav.setState({ focusId: null });
          }}
        />
      )}
    </div>
  );
}

function ModuleCard({
  module: m,
  openTasks,
  weekMin,
  totalMin,
  onOpen,
}: {
  module: Module;
  openTasks: number;
  weekMin: number;
  totalMin: number;
  onOpen: (tab: "general" | "plan") => void;
}) {
  const daysLeft = m.examDate ? daysBetween(todayStr(), m.examDate) : null;
  return (
    <div className="card module-card" onClick={() => onOpen("general")}>
      <span className="module-stripe" style={{ background: m.color }} />
      <div className="row between top">
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <h3 className="ellipsis">{m.name}</h3>
          <span className="row gap-4 wrap">
            {m.short && <span className="badge">{m.short}</span>}
            {m.ects ? <span className="badge">{m.ects} ECTS</span> : null}
            {m.semester && <span className="badge">{m.semester}</span>}
          </span>
        </div>
      </div>

      <div className="module-exam">
        <GraduationCap size={15} />
        {m.examDate && daysLeft !== null ? (
          daysLeft >= 0 ? (
            <span>
              Klausur {daysLeft === 0 ? "heute" : `in ${daysLeft} Tagen`}
              <span className="faint"> · {fmtDate(m.examDate, { day: "numeric", month: "short", year: "numeric" })}</span>
            </span>
          ) : (
            <span className="faint">Klausur war am {fmtDate(m.examDate, { day: "numeric", month: "short", year: "numeric" })}</span>
          )
        ) : (
          <span className="faint">kein Klausurtermin</span>
        )}
      </div>

      {m.weeklyGoalMinutes > 0 && (
        <div className="col gap-4">
          <div className="row between tiny muted">
            <span>Wochenziel</span>
            <span className="tabular">
              {fmtHours(weekMin)} / {fmtHours(m.weeklyGoalMinutes)}
            </span>
          </div>
          <ProgressBar value={weekMin / m.weeklyGoalMinutes} color={m.color} />
        </div>
      )}

      <div className="row between tiny muted">
        <span>
          {openTasks} offene {openTasks === 1 ? "Aufgabe" : "Aufgaben"} · {fmtHours(totalMin)} gesamt
        </span>
        {m.examDate && (
          <button
            className="btn sm soft"
            onClick={(e) => {
              e.stopPropagation();
              onOpen("plan");
            }}
          >
            Klausurplan
          </button>
        )}
      </div>
    </div>
  );
}

function examEventFor(m: Module): CalEvent | null {
  if (!m.examDate) return null;
  const allDay = !m.examTime;
  return {
    id: `exam-${m.id}`,
    title: `Klausur: ${m.name}`,
    type: "exam",
    start: allDay ? m.examDate : `${m.examDate}T${m.examTime}`,
    end: allDay
      ? (() => {
          const d = new Date(`${m.examDate}T12:00`);
          d.setDate(d.getDate() + 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })()
      : (() => {
          const [h, min] = m.examTime!.split(":").map(Number);
          const end = h * 60 + min + 120;
          return `${m.examDate}T${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
        })(),
    allDay,
    moduleId: m.id,
  };
}

function ModuleDialog({
  initial,
  initialTab,
  isNew,
  onClose,
}: {
  initial: Module;
  initialTab: "general" | "plan";
  isNew: boolean;
  onClose: () => void;
}) {
  const upsert = useData((s) => s.upsert);
  const remove = useData((s) => s.remove);
  const events = useData((s) => s.data.events);
  const stored = useData((s) => s.data.modules.find((m) => m.id === initial.id));
  const [draft, setDraft] = useState<Module>(stored ?? initial);
  const [tab, setTab] = useState(initialTab);
  const set = (patch: Partial<Module>) => setDraft((d) => ({ ...d, ...patch }));
  const valid = draft.name.trim().length > 0;
  const hasExamEvent = useMemo(() => events.some((e) => e.id === `exam-${draft.id}`), [events, draft.id]);

  const save = () => {
    if (!valid) return;
    const m = { ...draft, name: draft.name.trim(), short: draft.short?.trim() || undefined };
    upsert("modules", m);
    const exam = examEventFor(m);
    if (exam) upsert("events", exam);
    else if (hasExamEvent) remove("events", `exam-${m.id}`);
    return m;
  };

  const del = async () => {
    const ok = await confirmDanger(
      "Modul löschen?",
      "Aufgaben und Lernzeiten bleiben erhalten, verlieren aber die Zuordnung. Tipp: Archivieren blendet das Modul nur aus.",
    );
    if (!ok) return;
    remove("modules", draft.id);
    if (hasExamEvent) remove("events", `exam-${draft.id}`);
    onClose();
  };

  return (
    <Modal
      title={isNew ? "Neues Modul" : draft.name || "Modul"}
      onClose={onClose}
      size="wide"
      footer={
        tab === "general" ? (
          <>
            {!isNew && (
              <div className="left">
                <button className="btn ghost danger" onClick={() => void del()}>
                  Löschen
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    upsert("modules", { ...draft, archived: !draft.archived });
                    onClose();
                  }}
                >
                  {draft.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  {draft.archived ? "Wiederherstellen" : "Archivieren"}
                </button>
              </div>
            )}
            <button className="btn ghost" onClick={onClose}>
              Abbrechen
            </button>
            <button
              className="btn primary"
              disabled={!valid}
              onClick={() => {
                save();
                onClose();
              }}
            >
              Speichern
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>
            Fertig
          </button>
        )
      }
    >
      {!isNew && (
        <div className="tabs">
          <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>
            Allgemein
          </button>
          <button
            className={tab === "plan" ? "active" : ""}
            onClick={() => {
              save();
              setTab("plan");
            }}
          >
            Klausurplan
          </button>
        </div>
      )}
      {tab === "general" ? (
        <div className="form-grid">
          <div className="field span-2">
            <label>Name</label>
            <input className="input" autoFocus value={draft.name} placeholder="z. B. Corporate Finance" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>Kürzel</label>
            <input className="input" value={draft.short ?? ""} placeholder="z. B. CorpFin" onChange={(e) => set({ short: e.target.value })} />
          </div>
          <div className="field">
            <label>Semester</label>
            <input className="input" value={draft.semester ?? ""} placeholder="z. B. WiSe 26/27" onChange={(e) => set({ semester: e.target.value })} />
          </div>
          <div className="field span-2">
            <span className="field-label">Farbe</span>
            <ColorPicker value={draft.color} onChange={(c) => set({ color: c })} />
          </div>
          <div className="field">
            <label>Klausurdatum</label>
            <input type="date" className="input" value={draft.examDate ?? ""} onChange={(e) => set({ examDate: e.target.value || undefined })} />
          </div>
          <div className="field">
            <label>Uhrzeit (optional)</label>
            <input type="time" className="input" value={draft.examTime ?? ""} onChange={(e) => set({ examTime: e.target.value || undefined })} />
          </div>
          <div className="field">
            <span className="field-label">ECTS</span>
            <Stepper value={draft.ects ?? 0} min={0} max={30} onChange={(v) => set({ ects: v || undefined })} />
          </div>
          <div className="field">
            <span className="field-label">Wochenziel</span>
            <Stepper
              value={Math.round(draft.weeklyGoalMinutes / 30) / 2}
              min={0}
              max={40}
              step={0.5}
              suffix=" h"
              onChange={(v) => set({ weeklyGoalMinutes: Math.round(v * 60) })}
            />
          </div>
          <div className="field span-2">
            <label>Notizen</label>
            <textarea
              className="textarea"
              value={draft.notes ?? ""}
              placeholder="z. B. Prüfungsform, erlaubte Hilfsmittel, Moodle-Link …"
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
          {draft.examDate && <p className="tiny faint span-2">Der Klausurtermin wird automatisch in deinen Kalender eingetragen.</p>}
        </div>
      ) : (
        <ExamPlanner module={stored ?? draft} />
      )}
    </Modal>
  );
}
