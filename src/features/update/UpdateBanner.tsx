import { Download, Sparkles } from "lucide-react";
import { ask } from "../../components/ui";
import { useTimer } from "../timer/timerStore";
import { installUpdate, snoozeUpdate, useUpdate } from "./updater";

/** Hinweis oben in der App, wenn eine neue Version bereitsteht. */
export function UpdateBanner() {
  const { available, status, progress, error, snoozed } = useUpdate();
  const busy = status === "downloading" || status === "installing";
  if (!available || (snoozed === available.version && !busy && status !== "error")) return null;

  const start = async () => {
    const t = useTimer.getState();
    if (t.status !== "idle") {
      const ok = await ask(
        "Timer läuft gerade",
        "Für das Update startet Fokus neu. Deine bisherige Lernzeit wird gespeichert, der Timer danach zurückgesetzt.",
        [{ value: "ok", label: "Jetzt aktualisieren", kind: "primary" }],
      );
      if (ok !== "ok") return;
    }
    await installUpdate();
  };

  const notes = available.notes?.split("\n").find((l) => l.trim().length > 0)?.trim();

  return (
    <div className="banner info app-banner update-banner">
      <Sparkles size={16} />
      <div className="grow col" style={{ gap: 0, minWidth: 0 }}>
        <span>
          <strong>Neue Version {available.version}</strong>
          {busy ? (status === "installing" ? " wird installiert – Fokus startet gleich neu …" : " wird heruntergeladen …") : " ist verfügbar."}
        </span>
        {notes && !busy && <span className="tiny muted ellipsis">{notes}</span>}
        {error && <span className="tiny" style={{ color: "var(--danger)" }}>{error}</span>}
        {busy && (
          <div className="progress mt-4" style={{ maxWidth: 320 }}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      {!busy && (
        <>
          <button className="btn sm ghost" onClick={snoozeUpdate}>
            Später
          </button>
          <button className="btn sm primary" onClick={() => void start()}>
            <Download size={14} /> Jetzt aktualisieren
          </button>
        </>
      )}
    </div>
  );
}
