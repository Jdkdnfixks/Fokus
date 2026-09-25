import { useMemo, useState } from "react";
import { ListTodo } from "lucide-react";
import { Empty, Segmented, Switch } from "../../components/ui";
import { fmtDuration } from "../../lib/time";
import { useData, useSettings } from "../../store/data";
import { useNav } from "../../store/nav";
import type { ID, Task } from "../../store/types";
import { pomodorosByTask } from "../stats/stats";
import { useTimer } from "../timer/timerStore";
import { QuickAddTask } from "./QuickAdd";
import { TaskRow } from "./TaskRow";

type Filter = "all" | "none" | ID;
type Sort = "due" | "new";

export function TasksPage() {
  const tasks = useData((s) => s.data.tasks);
  const modules = useData((s) => s.data.modules);
  const sessions = useData((s) => s.data.sessions);
  const focusMinutes = useSettings().timer.focus;
  const selectTask = useTimer((s) => s.selectTask);
  const navigate = useNav((s) => s.navigate);
  const [filter, setFilter] = useState<Filter>("all");
  const [showDone, setShowDone] = useState(false);
  const [sort, setSort] = useState<Sort>("due");
  const counts = useMemo(() => pomodorosByTask(sessions), [sessions]);

  const activeModules = modules.filter((m) => !m.archived);
  const matches = (t: Task) => (filter === "all" ? true : filter === "none" ? !t.moduleId : t.moduleId === filter);
  const sorter = (a: Task, b: Task) =>
    sort === "due"
      ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.createdAt.localeCompare(b.createdAt)
      : b.createdAt.localeCompare(a.createdAt);

  const open = tasks.filter((t) => !t.done && matches(t)).sort(sorter);
  const done = tasks
    .filter((t) => t.done && matches(t))
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));

  const remainingPomodoros = open.reduce((sum, t) => sum + Math.max(0, t.estimate - (counts.get(t.id) ?? 0)), 0);

  const focusOn = (t: Task) => {
    selectTask(t.id);
    navigate("timer");
  };

  const groups: { key: string; title: string; color?: string; items: Task[] }[] =
    filter === "all"
      ? [
          ...activeModules.map((m) => ({ key: m.id, title: m.name, color: m.color, items: open.filter((t) => t.moduleId === m.id) })),
          { key: "none", title: "Ohne Modul", items: open.filter((t) => !t.moduleId || !activeModules.some((m) => m.id === t.moduleId)) },
        ].filter((g) => g.items.length)
      : [{ key: "list", title: "", items: open }];

  const moduleForAdd = filter !== "all" && filter !== "none" ? filter : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Aufgaben</h1>
          <p className="subtitle">
            {open.length} offen
            {remainingPomodoros > 0 && ` · noch etwa ${remainingPomodoros} Pomodoros (≈ ${fmtDuration(remainingPomodoros * focusMinutes)})`}
          </p>
        </div>
        <div className="row gap-16">
          <Segmented<Sort>
            value={sort}
            onChange={setSort}
            options={[
              { value: "due", label: "Nach Fälligkeit" },
              { value: "new", label: "Neueste zuerst" },
            ]}
          />
          <Switch checked={showDone} onChange={setShowDone} label={<span className="small muted">Erledigte</span>} />
        </div>
      </div>

      <div className="row wrap mb-16">
        <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          Alle
        </button>
        {activeModules.map((m) => (
          <button key={m.id} className={`chip ${filter === m.id ? "active" : ""}`} onClick={() => setFilter(m.id)}>
            <span className="dot" style={{ background: m.color }} />
            {m.short || m.name}
          </button>
        ))}
        <button className={`chip ${filter === "none" ? "active" : ""}`} onClick={() => setFilter("none")}>
          Ohne Modul
        </button>
      </div>

      <div className="card">
        <QuickAddTask key={String(moduleForAdd)} moduleId={moduleForAdd} showModule={filter === "all"} showDue />
        {groups.map((g) => (
          <div key={g.key} className="task-group">
            {g.title && (
              <div className="task-group-title">
                {g.color && <span className="dot" style={{ background: g.color }} />}
                <span>{g.title}</span>
                <span className="faint">{g.items.length}</span>
              </div>
            )}
            <div className="list">
              {g.items.map((t) => (
                <TaskRow key={t.id} task={t} done={counts.get(t.id) ?? 0} showModule={filter === "all" ? false : filter === "none"} onFocus={() => focusOn(t)} />
              ))}
            </div>
          </div>
        ))}
        {!open.length && (
          <Empty
            icon={<ListTodo size={20} />}
            title="Alles erledigt"
            text="Lege oben neue Aufgaben an und schätze, wie viele Pomodoros du dafür brauchst."
          />
        )}
        {showDone && done.length > 0 && (
          <div className="task-group">
            <div className="task-group-title">
              <span>Erledigt</span>
              <span className="faint">{done.length}</span>
            </div>
            <div className="list">
              {done.slice(0, 50).map((t) => (
                <TaskRow key={t.id} task={t} done={counts.get(t.id) ?? 0} />
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="tiny faint mt-12">
        Tipp: Doppelklick auf eine Aufgabe zum Umbenennen. Mit dem Fadenkreuz-Symbol lernst du direkt mit dieser Aufgabe. Jede abgeschlossene
        Lernphase zählt als Pomodoro.
      </p>
    </div>
  );
}
