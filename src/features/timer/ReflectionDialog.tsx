import { useState } from "react";
import { Modal } from "../../components/ui";
import { useData } from "../../store/data";
import { useTimer } from "./timerStore";

const RATINGS = [
  { v: 1, label: "zerstreut" },
  { v: 2, label: "unruhig" },
  { v: 3, label: "okay" },
  { v: 4, label: "gut" },
  { v: 5, label: "voll fokussiert" },
];

/** Kurze Reflexion nach einer abgeschlossenen Lernphase */
export function ReflectionDialog() {
  const id = useTimer((s) => s.reflectionId);
  const close = useTimer((s) => s.closeReflection);
  const session = useData((s) => (id ? s.data.sessions.find((x) => x.id === id) : undefined));
  const task = useData((s) => (session?.taskId ? s.data.tasks.find((t) => t.id === session.taskId) : undefined));
  const patch = useData((s) => s.patch);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [taskDone, setTaskDone] = useState(false);

  if (!id || !session) return null;

  const finish = (save: boolean) => {
    if (save) {
      patch("sessions", session.id, { rating: rating ?? undefined, note: note.trim() || undefined });
      if (task && taskDone && !task.done) patch("tasks", task.id, { done: true, doneAt: new Date().toISOString() });
    }
    setRating(null);
    setNote("");
    setTaskDone(false);
    close();
  };

  return (
    <Modal
      title="Lernphase geschafft"
      onClose={() => finish(false)}
      footer={
        <>
          <button className="btn ghost" onClick={() => finish(false)}>
            Überspringen
          </button>
          <button className="btn primary" onClick={() => finish(true)}>
            Speichern
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <p className="muted">
          {Math.round(session.focusMinutes)} Minuten konzentriert gelernt. Nimm dir kurz Zeit für einen Rückblick. Mit der Zeit zeigt
          dir die Statistik, zu welchen Tageszeiten du am besten lernst.
        </p>
        <div className="field">
          <span className="field-label">Wie gut konntest du dich konzentrieren?</span>
          <div className="rating-row">
            {RATINGS.map((r) => (
              <button key={r.v} className={`rating-btn ${rating === r.v ? "active" : ""}`} onClick={() => setRating(r.v)}>
                <span className="rating-num">{r.v}</span>
                <span className="tiny">{r.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="reflection-note">Was hast du geschafft?</label>
          <textarea
            id="reflection-note"
            className="textarea"
            placeholder="z. B. Kapitel 3 zusammengefasst, 5 Übungsaufgaben gerechnet …"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {task && !task.done && (
          <label className="row small" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={taskDone} onChange={(e) => setTaskDone(e.target.checked)} />
            Aufgabe „{task.title}“ ist erledigt
          </label>
        )}
      </div>
    </Modal>
  );
}
