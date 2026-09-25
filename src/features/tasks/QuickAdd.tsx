import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { ModuleSelect, Stepper } from "../../components/ui";
import { uid } from "../../lib/ids";
import { useData } from "../../store/data";
import type { ID } from "../../store/types";

export function QuickAddTask({
  moduleId,
  showModule = true,
  showDue = false,
  compact = false,
}: {
  moduleId: ID | null;
  showModule?: boolean;
  showDue?: boolean;
  compact?: boolean;
}) {
  const upsert = useData((s) => s.upsert);
  const [title, setTitle] = useState("");
  const [mod, setMod] = useState<ID | null>(moduleId);
  const [estimate, setEstimate] = useState(1);
  const [due, setDue] = useState("");

  useEffect(() => setMod(moduleId), [moduleId]);

  const effectiveModule = showModule ? mod : moduleId;

  const add = () => {
    const t = title.trim();
    if (!t) return;
    upsert("tasks", {
      id: uid(),
      title: t,
      moduleId: effectiveModule,
      estimate,
      done: false,
      dueDate: due || undefined,
      createdAt: new Date().toISOString(),
    });
    setTitle("");
    setEstimate(1);
    setDue("");
  };

  return (
    <div className={`quick-add ${compact ? "compact" : ""}`}>
      <Plus size={16} className="faint" />
      <input
        className="input bare grow"
        placeholder="Neue Aufgabe …"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      {title.trim() && (
        <>
          {showModule && <ModuleSelect className="select sm" value={mod} onChange={setMod} />}
          {showDue && <input type="date" className="input sm" style={{ width: 140 }} value={due} onChange={(e) => setDue(e.target.value)} />}
          <span className="row gap-4 tiny faint" title="Geschätzte Pomodoros">
            <Stepper size="sm" value={estimate} min={0} max={30} onChange={setEstimate} />
          </span>
          <button className="btn sm primary" onClick={add}>
            Hinzufügen
          </button>
        </>
      )}
    </div>
  );
}
