import { useState } from "react";
import { CalendarDays, Crosshair, Trash2 } from "lucide-react";
import { ModuleTag, RoundCheck, Stepper } from "../../components/ui";
import { fmtDate, relativeDays, todayStr } from "../../lib/time";
import { useData } from "../../store/data";
import type { Task } from "../../store/types";

/** Pomodoro-Fortschritt als ruhige Punktreihe */
export function PomodoroDots({ done, estimate }: { done: number; estimate: number }) {
  if (estimate <= 0 && done === 0) return null;
  if (Math.max(done, estimate) > 8) {
    return (
      <span className="tiny faint tabular nowrap">
        {done}/{estimate}
      </span>
    );
  }
  const total = Math.max(done, estimate);
  return (
    <span className="pomo-dots" title={`${done} von ${estimate} Pomodoros`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? "on" : i >= estimate ? "extra" : ""} />
      ))}
    </span>
  );
}

export function TaskRow({
  task,
  done,
  showModule = true,
  selected,
  onFocus,
}: {
  task: Task;
  done: number;
  showModule?: boolean;
  selected?: boolean;
  onFocus?: () => void;
}) {
  const patch = useData((s) => s.patch);
  const remove = useData((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);

  const toggle = () =>
    patch("tasks", task.id, task.done ? { done: false, doneAt: undefined } : { done: true, doneAt: new Date().toISOString() });

  const commit = () => {
    setEditing(false);
    const t = title.trim();
    if (t && t !== task.title) patch("tasks", task.id, { title: t });
    else setTitle(task.title);
  };

  const overdue = !task.done && task.dueDate && task.dueDate < todayStr();

  return (
    <div className={`list-item task-row ${selected ? "selected" : ""} ${task.done ? "is-done" : ""}`}>
      <RoundCheck on={task.done} onClick={toggle} />
      <div className="grow col gap-4" style={{ gap: 1 }}>
        {editing ? (
          <input
            className="input sm"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setTitle(task.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="task-title ellipsis" onDoubleClick={() => setEditing(true)} title="Doppelklick zum Bearbeiten">
            {task.title}
          </span>
        )}
        {(showModule && task.moduleId) || task.dueDate ? (
          <span className="row gap-12 nowrap" style={{ overflow: "hidden" }}>
            {showModule && <ModuleTag id={task.moduleId} />}
            {task.dueDate && (
              <span className={`row gap-4 tiny ${overdue ? "" : "faint"}`} style={overdue ? { color: "var(--danger)" } : undefined}>
                <CalendarDays size={12} />
                {fmtDate(task.dueDate, { day: "numeric", month: "short" })} · {relativeDays(task.dueDate)}
              </span>
            )}
          </span>
        ) : null}
      </div>
      <PomodoroDots done={done} estimate={task.estimate} />
      <div className="actions">
        <Stepper size="sm" value={task.estimate} min={0} max={30} onChange={(v) => patch("tasks", task.id, { estimate: v })} />
        {onFocus && !task.done && (
          <button className="icon-btn sm" onClick={onFocus} title="Mit dieser Aufgabe lernen">
            <Crosshair size={15} />
          </button>
        )}
        <button className="icon-btn sm" onClick={() => remove("tasks", task.id)} title="Löschen">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
