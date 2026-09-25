import { useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { useData } from "../../store/data";
import { useNav, type Page } from "../../store/nav";
import { useBlocker } from "../blocker/blocker";
import { useSpotify } from "../music/spotify";

const KEY = "fokus-willkommen-ausgeblendet";

/** Checkliste für die ersten Schritte – verschwindet, wenn alles erledigt oder ausgeblendet ist. */
export function WelcomeCard() {
  const modules = useData((s) => s.data.modules.length);
  const events = useData((s) => s.data.events.length);
  const tracks = useData((s) => s.data.tracks.length);
  const isDefaultDir = useData((s) => s.storage?.isDefault ?? true);
  const spotify = useSpotify((s) => s.connected);
  const blockerReady = useBlocker((s) => s.status?.writable ?? false);
  const navigate = useNav((s) => s.navigate);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  const steps: { done: boolean; title: string; text: string; page: Page; focus?: string }[] = [
    { done: modules > 0, title: "Module anlegen", text: "Eins pro Lehrveranstaltung – mit Klausurdatum und Wochenziel.", page: "modules" },
    { done: events > 0, title: "Woche planen", text: "Stundenplan importieren oder Termine und Lernblöcke eintragen.", page: "calendar" },
    {
      done: !isDefaultDir,
      title: "PC & Laptop verbinden",
      text: "Datenordner in OneDrive oder Sciebo legen.",
      page: "settings",
      focus: "data",
    },
    { done: spotify || tracks > 0, title: "Lernmusik einrichten", text: "Spotify verbinden oder eigene MP3s hinzufügen.", page: "music" },
    { done: blockerReady, title: "Website-Blocker einrichten", text: "Einmal bestätigen, dann sperrt Fokus Ablenkungen.", page: "settings", focus: "blocker" },
  ];
  const open = steps.filter((s) => !s.done).length;
  if (hidden || open === 0) return null;

  const hide = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* egal */
    }
    setHidden(true);
  };

  return (
    <div className="card welcome-card">
      <div className="card-header">
        <div className="col" style={{ gap: 0 }}>
          <h3>Erste Schritte</h3>
          <span className="tiny faint">
            {steps.length - open} von {steps.length} erledigt
          </span>
        </div>
        <button className="icon-btn sm" onClick={hide} title="Ausblenden">
          <X size={15} />
        </button>
      </div>
      <div className="list">
        {steps.map((s) => (
          <button key={s.title} className={`list-item welcome-step ${s.done ? "done" : ""}`} onClick={() => navigate(s.page, s.focus ?? null)}>
            <span className={`check ${s.done ? "on" : ""}`}>
              <Check size={12} strokeWidth={3} />
            </span>
            <span className="grow col" style={{ gap: 0 }}>
              <span className="small strong">{s.title}</span>
              <span className="tiny faint">{s.text}</span>
            </span>
            {!s.done && <ChevronRight size={15} className="faint" />}
          </button>
        ))}
      </div>
    </div>
  );
}
