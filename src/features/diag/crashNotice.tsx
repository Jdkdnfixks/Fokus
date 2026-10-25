import { ask, toast } from "../../components/ui";
import { callOr } from "../../lib/tauri";
import { useData } from "../../store/data";

interface DiagEvent {
  at: number;
  text: string;
}

export interface DiagReport {
  version: string;
  startedAt: number;
  lastAlive: number;
  events: DiagEvent[];
  panic?: string | null;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Was hat Fokus zuletzt getan? Liefert die wahrscheinliche Ursache für die Anzeige. */
export function analyzeReport(r: DiagReport) {
  const end = r.lastAlive || r.startedAt;
  const last = r.events.at(-1);
  const blockerShortlyBefore = r.events.some((e) => e.text.startsWith("Website-Blocker: hosts-Datei") && end - e.at <= 120_000);
  // Messung begonnen, aber nicht beendet
  const measuringFile = last?.text.startsWith("Lautstärke messen: ") ? last.text.slice("Lautstärke messen: ".length) : null;
  const cause: "panic" | "measure" | "blocker" | "unknown" = r.panic
    ? measuringFile
      ? "measure"
      : "panic"
    : measuringFile
      ? "measure"
      : blockerShortlyBefore
        ? "blocker"
        : "unknown";
  return { end, cause, measuringFile, recent: r.events.filter((e) => e.at >= end - 3 * 60_000).slice(-8) };
}

export function reportText(r: DiagReport): string {
  return [
    `Fokus ${r.version}`,
    `Start: ${new Date(r.startedAt).toLocaleString("de-DE")}`,
    `Letztes Lebenszeichen: ${new Date(r.lastAlive).toLocaleString("de-DE")}`,
    r.panic ? `Fehler: ${r.panic}` : null,
    "Letzte Aktionen:",
    ...r.events.map((e) => `  ${time(e.at)}  ${e.text}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Beim Start: Ist Fokus beim letzten Mal unerwartet beendet worden? Dann erklären und Hilfe anbieten. */
export async function checkPreviousCrash() {
  const r = await callOr<DiagReport | null>("diag_previous", undefined, null).catch(() => null);
  if (!r) return;
  const { end, cause, measuringFile, recent } = analyzeReport(r);
  const track = measuringFile ? useData.getState().data.tracks.find((t) => t.file === measuringFile) : undefined;

  const causeText =
    cause === "measure"
      ? `Fokus hat gerade die Lautstärke von „${track?.title ?? measuringFile}“ gemessen. Diese Datei lässt sich offenbar nicht lesen.`
      : cause === "panic"
        ? `Ursache war ein Programmfehler: ${r.panic}`
        : cause === "blocker"
          ? "Kurz davor hat der Website-Blocker die hosts-Datei von Windows geändert. Wahrscheinlich hat der Virenschutz (Windows Defender) Fokus deshalb beendet – schau unter Windows-Sicherheit → Schutzverlauf nach."
          : "Die Ursache ist unklar – zum Beispiel ein Absturz, der Virenschutz oder das Herunterfahren des PCs.";

  const choices = [
    ...(cause === "blocker" ? [{ value: "blocker-off", label: "Website-Blocker ausschalten", kind: "primary" as const }] : []),
    ...(cause === "measure" && track ? [{ value: "skip-file", label: "Datei nicht mehr messen", kind: "primary" as const }] : []),
    { value: "copy", label: "Details kopieren" },
  ];

  const choice = await ask(
    "Fokus wurde unerwartet beendet",
    <div className="col gap-8">
      <span>
        Beim letzten Mal (Version {r.version}) hat sich Fokus gegen {time(end).slice(0, 5)} Uhr unerwartet beendet.
      </span>
      <span>{causeText}</span>
      {recent.length > 0 && (
        <div className="small">
          <div className="strong">Zuletzt:</div>
          {recent.map((e, i) => (
            <div key={i} className="tabular">
              {time(e.at)} · {e.text}
            </div>
          ))}
        </div>
      )}
    </div>,
    choices,
    "Schließen",
  );

  if (choice === "blocker-off") {
    useData.getState().setSettings((s) => ({ ...s, blocker: { ...s.blocker, enabled: false } }));
    toast("Website-Blocker ist aus. Du kannst ihn in den Einstellungen wieder einschalten.", "success", 6000);
  } else if (choice === "skip-file" && track) {
    useData.getState().patch("tracks", track.id, { loudness: null, peak: null });
    toast(`„${track.title}“ läuft ab jetzt in Originallautstärke.`, "success", 5000);
  } else if (choice === "copy") {
    try {
      await navigator.clipboard.writeText(reportText(r));
      toast("Details kopiert – füge sie einfach im Chat ein.", "success", 5000);
    } catch {
      toast("Kopieren hat nicht geklappt.", "error");
    }
  }
}
