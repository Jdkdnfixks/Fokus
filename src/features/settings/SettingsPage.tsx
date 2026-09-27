import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  Check,
  FolderOpen,
  HardDrive,
  Laptop,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldBan,
  ShieldCheck,
  Sun,
  Timer,
  Upload,
  Download,
  X,
} from "lucide-react";
import { Segmented, Slider, Stepper, Switch, ask, confirmDanger, toast } from "../../components/ui";
import { playChime, previewCountdown } from "../../lib/sounds";
import { call, errorText, isTauri } from "../../lib/tauri";
import { fmtDate, todayStr } from "../../lib/time";
import { DEFAULT_BLOCKLIST, normalizeData } from "../../store/defaults";
import { flushBeforeQuit, useData, useSettings } from "../../store/data";
import { useNav } from "../../store/nav";
import type { StorageInfo } from "../../store/persistence";
import type { Accent, ChimeSound, Settings, ThemeMode } from "../../store/types";
import { normalizeDomain, refreshBlockerStatus, setupBlocker, teardownBlocker, useBlocker } from "../blocker/blocker";
import { setMusicDir } from "../music/localPlayer";
import { checkForUpdates, installUpdate, loadCurrentVersion, useUpdate } from "../update/updater";

function Section({ id, icon, title, children, desc }: { id: string; icon: ReactNode; title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card settings-section" id={`s-${id}`}>
      <div className="card-header" style={{ marginBottom: desc ? 4 : 12 }}>
        <h2>
          {icon} {title}
        </h2>
      </div>
      {desc && <p className="small muted mb-16">{desc}</p>}
      {children}
    </section>
  );
}

function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span>{title}</span>
        {desc && <span className="desc">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const focusId = useNav((s) => s.focusId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`s-${focusId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusId]);

  return (
    <div className="page settings-page" ref={ref}>
      <div className="page-header">
        <div>
          <h1>Einstellungen</h1>
          <p className="subtitle">Alles wird automatisch gespeichert.</p>
        </div>
      </div>
      <div className="col gap-16" style={{ maxWidth: 820 }}>
        <AppearanceSection />
        <TimerSection />
        <BlockerSection />
        <DataSection />
        <SystemSection />
      </div>
    </div>
  );
}

function useSet() {
  const setSettings = useData((s) => s.setSettings);
  return <K extends keyof Settings>(key: K, patch: Partial<Settings[K]> | Settings[K]) =>
    setSettings((s) => ({
      ...s,
      [key]: typeof patch === "object" && patch !== null && !Array.isArray(patch) ? { ...(s[key] as object), ...patch } : patch,
    }));
}

const ACCENTS: { value: Accent; label: string; color: string }[] = [
  { value: "salbei", label: "Salbei", color: "#5d876d" },
  { value: "see", label: "See", color: "#5a7f9c" },
  { value: "lavendel", label: "Lavendel", color: "#7d74a3" },
  { value: "sand", label: "Sand", color: "#9a7d55" },
];

function AppearanceSection() {
  const settings = useSettings();
  const set = useSet();
  return (
    <Section id="appearance" icon={<Palette size={18} />} title="Darstellung">
      <Row title="Farbmodus" desc="„System“ folgt der Windows-Einstellung.">
        <Segmented<ThemeMode>
          value={settings.theme}
          onChange={(v) => set("theme", v)}
          options={[
            { value: "system", label: <span className="row gap-4"><Monitor size={14} /> System</span> },
            { value: "light", label: <span className="row gap-4"><Sun size={14} /> Hell</span> },
            { value: "dark", label: <span className="row gap-4"><Moon size={14} /> Dunkel</span> },
          ]}
        />
      </Row>
      <Row title="Akzentfarbe" desc="Gedeckte Töne, die nicht ablenken.">
        <div className="row gap-12">
          {ACCENTS.map((a) => (
            <button key={a.value} className={`accent-choice ${settings.accent === a.value ? "active" : ""}`} onClick={() => set("accent", a.value)}>
              <span className="accent-swatch" style={{ background: a.color }}>
                {settings.accent === a.value && <Check size={13} color="#fff" />}
              </span>
              <span className="tiny">{a.label}</span>
            </button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

function TimerSection() {
  const t = useSettings().timer;
  const general = useSettings().general;
  const set = useSet();
  return (
    <Section id="timer" icon={<Timer size={18} />} title="Timer">
      <Row title="Signalton am Phasenende">
        <div className="row">
          <Segmented<ChimeSound>
            value={t.sound}
            onChange={(v) => {
              set("timer", { sound: v });
              playChime(v, t.soundVolume);
            }}
            options={[
              { value: "glocke", label: "Glocke" },
              { value: "holz", label: "Holz" },
              { value: "sanft", label: "Sanft" },
              { value: "aus", label: "Aus" },
            ]}
          />
        </div>
      </Row>
      <Row title="Lautstärke des Signals">
        <div className="row" style={{ width: 220 }}>
          <Slider value={t.soundVolume} onChange={(v) => set("timer", { soundVolume: v })} ariaLabel="Lautstärke" />
          <button className="btn sm" onClick={() => playChime(t.sound, t.soundVolume)}>
            Test
          </button>
        </div>
      </Row>
      <Row title="Countdown in den letzten 5 Sekunden" desc="Ein kurzer Ton pro Sekunde zählt das Ende jeder Lern- und Pausenphase herunter.">
        <div className="row">
          <button className="btn sm" onClick={() => previewCountdown(t.sound, t.soundVolume)} disabled={t.sound === "aus"}>
            Anhören
          </button>
          <Switch checked={t.countdownTicks} onChange={(v) => set("timer", { countdownTicks: v })} />
        </div>
      </Row>
      <Row title={<span className="row gap-4"><Bell size={14} /> Windows-Benachrichtigungen</span>} desc="Auch wenn Fokus minimiert ist.">
        <Switch checked={t.notifications} onChange={(v) => set("timer", { notifications: v })} />
      </Row>
      <Row
        title="Phasen automatisch nacheinander starten"
        desc="Lernphasen und Pausen laufen ohne Klick weiter, bis alle Einheiten eines Durchgangs geschafft sind. Danach wartet der Timer."
      >
        <Switch checked={t.autoContinue} onChange={(v) => set("timer", { autoContinue: v })} />
      </Row>
      <Row title="Reflexion nach jeder Lernphase" desc="Kurze Frage nach Konzentration und Ergebnis – Grundlage für die Statistik „beste Lernzeit“.">
        <Switch checked={t.reflection} onChange={(v) => set("timer", { reflection: v })} />
      </Row>
      <Row title="Sichtbarer Tag im Kalender">
        <div className="row">
          <Stepper value={general.dayStartHour} min={0} max={12} suffix=" Uhr" onChange={(v) => set("general", { dayStartHour: v })} />
          <span className="faint">bis</span>
          <Stepper value={general.dayEndHour} min={14} max={24} suffix=" Uhr" onChange={(v) => set("general", { dayEndHour: v })} />
        </div>
      </Row>
    </Section>
  );
}

function BlockerSection() {
  const b = useSettings().blocker;
  const set = useSet();
  const { status, busy, error } = useBlocker();
  const [input, setInput] = useState("");

  useEffect(() => {
    void refreshBlockerStatus();
  }, []);

  const add = () => {
    const parts = input.split(/[\s,;]+/).map(normalizeDomain).filter(Boolean) as string[];
    if (!parts.length) {
      if (input.trim()) toast("Das sieht nicht nach einer Website-Adresse aus.", "error");
      return;
    }
    set("blocker", { domains: [...new Set([...b.domains, ...parts])] });
    setInput("");
  };

  return (
    <Section
      id="blocker"
      icon={<ShieldBan size={18} />}
      title="Website-Blocker"
      desc="Sperrt ablenkende Seiten während deiner Lernphasen in allen Browsern. In den Pausen und nach dem Timer sind sie wieder erreichbar."
    >
      <Row title="Blocker verwenden">
        <Switch checked={b.enabled} onChange={(v) => set("blocker", { enabled: v })} />
      </Row>
      <Row title="Auch in Pausen sperren" desc="Hilft, wenn die Pause sonst zu Instagram führt.">
        <Switch checked={b.blockInBreaks} onChange={(v) => set("blocker", { blockInBreaks: v })} />
      </Row>

      <div className="setting" style={{ alignItems: "flex-start" }}>
        <div className="setting-text">
          <span>Einrichtung</span>
          <span className="desc">
            Windows erlaubt Änderungen an der Sperrliste (hosts-Datei) nur mit Administratorrechten. Einmalig bestätigst du dafür eine
            Windows-Abfrage, danach funktioniert alles automatisch.
          </span>
        </div>
        <div className="col" style={{ alignItems: "flex-end", flex: "none" }}>
          {status?.writable ? (
            <>
              <span className="badge accent">
                <ShieldCheck size={13} /> Eingerichtet
              </span>
              {status.supportedSetup && (
                <button className="btn sm ghost" disabled={busy} onClick={() => void teardownBlocker()}>
                  Berechtigung entfernen
                </button>
              )}
            </>
          ) : (
            <button className="btn primary" disabled={busy || !status?.supportedSetup} onClick={() => void setupBlocker()}>
              {busy ? "Warte auf Windows …" : "Jetzt einrichten"}
            </button>
          )}
        </div>
      </div>
      {status?.active && (
        <div className="banner info mt-8">
          <ShieldBan size={15} /> Gerade gesperrt: {status.blocked.length} Seiten
        </div>
      )}
      {error && <div className="banner danger mt-8">{error}</div>}

      <div className="setting" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div className="setting-text">
          <span>Gesperrte Seiten</span>
          <span className="desc">Subdomains wie „www.“ werden automatisch mitgesperrt.</span>
        </div>
        <div className="row wrap gap-4 mt-8">
          {b.domains.map((d) => (
            <span key={d} className="domain-chip">
              {d}
              <button onClick={() => set("blocker", { domains: b.domains.filter((x) => x !== d) })} aria-label={`${d} entfernen`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="row mt-8">
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="z. B. spiegel.de"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn" onClick={add}>
            <Plus size={15} /> Hinzufügen
          </button>
          <button className="btn ghost" onClick={() => set("blocker", { domains: DEFAULT_BLOCKLIST })} title="Standardliste wiederherstellen">
            <RotateCcw size={14} /> Standard
          </button>
        </div>
      </div>
      <p className="tiny faint mt-8">
        Hinweis: Bereits geöffnete Tabs sind oft erst nach dem Neuladen gesperrt. Lädt eine Seite trotzdem, starte den Browser einmal neu.
        Beim Beenden von Fokus wird jede Sperre automatisch aufgehoben.
      </p>
    </Section>
  );
}

interface DirInspection {
  exists: boolean;
  hasData: boolean;
  dataModifiedMs: number | null;
}
interface BackupEntry {
  file: string;
  modifiedMs: number;
}

function DataSection() {
  const storage = useData((s) => s.storage);
  const device = useData((s) => s.device);
  const otherDevice = useData((s) => s.otherDevice);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const loadBackups = () => {
    if (isTauri) void call<BackupEntry[]>("backup_list").then(setBackups).catch(() => {});
  };
  useEffect(loadBackups, [storage?.dataDir]);

  const applyStorage = async (info: StorageInfo) => {
    useData.setState({ storage: info });
    setMusicDir(info.musicDir);
    await useData.getState().reload();
    loadBackups();
  };

  const changeDir = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Datenordner wählen (z. B. in OneDrive oder Sciebo)" });
    if (typeof dir !== "string") return;
    try {
      setBusy(true);
      const insp = await call<DirInspection>("storage_inspect_dir", { path: dir });
      let mode = "move-current";
      if (insp.hasData) {
        const choice = await ask(
          "Im Ordner liegen bereits Fokus-Daten",
          <>
            Zuletzt geändert: {insp.dataModifiedMs ? new Date(insp.dataModifiedMs).toLocaleString("de-DE") : "unbekannt"}.
            <br />
            Nutzt du Fokus schon auf einem anderen Gerät, wähle „Diese Daten verwenden“.
          </>,
          [
            { value: "move-current", label: "Meine Daten dorthin kopieren" },
            { value: "use-existing", label: "Diese Daten verwenden", kind: "primary" },
          ],
        );
        if (!choice) return;
        mode = choice;
      }
      await flushBeforeQuit();
      const info = await call<StorageInfo>("storage_set_dir", { path: dir, mode });
      await applyStorage(info);
      toast("Datenordner geändert.", "success");
    } catch (e) {
      toast(`Ordner konnte nicht geändert werden: ${errorText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const useDefault = async () => {
    if (!(await confirmDanger("Lokalen Standardordner verwenden?", "Fokus liest dann die Daten aus dem lokalen App-Ordner dieses Geräts.", "Wechseln")))
      return;
    await flushBeforeQuit();
    await applyStorage(await call<StorageInfo>("storage_use_default"));
  };

  const restore = async (b: BackupEntry) => {
    const ok = await confirmDanger(
      "Sicherung wiederherstellen?",
      `Der aktuelle Stand wird durch die Sicherung „${b.file}“ ersetzt. Die heutige Sicherung bleibt erhalten.`,
      "Wiederherstellen",
    );
    if (!ok) return;
    try {
      const content = await call<string>("backup_read", { file: b.file });
      useData.getState().replaceData(normalizeData(JSON.parse(content)));
      await useData.getState().flush(true);
      toast("Sicherung wiederhergestellt.", "success");
    } catch (e) {
      toast(`Wiederherstellen fehlgeschlagen: ${errorText(e)}`, "error");
    }
  };

  const exportJson = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: `fokus-export-${todayStr()}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    await call("write_text_file", { path, content: JSON.stringify(useData.getState().data, null, 2) });
    toast("Export gespeichert.", "success");
  };

  const importJson = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const data = normalizeData(JSON.parse(await call<string>("read_text_file", { path })));
      const ok = await confirmDanger(
        "Daten importieren?",
        `${data.modules.length} Module, ${data.tasks.length} Aufgaben, ${data.sessions.length} Lerneinheiten und ${data.events.length} Termine ersetzen deinen aktuellen Stand.`,
        "Importieren",
      );
      if (!ok) return;
      useData.getState().replaceData(data);
      toast("Import abgeschlossen.", "success");
    } catch (e) {
      toast(`Import fehlgeschlagen: ${errorText(e)}`, "error");
    }
  };

  return (
    <Section
      id="data"
      icon={<HardDrive size={18} />}
      title="Daten & Synchronisation"
      desc="Damit PC und Laptop dieselben Daten haben, lege den Datenordner in einen Cloud-Ordner (OneDrive, Sciebo, Dropbox …). Auf dem zweiten Gerät wählst du denselben Ordner und „Diese Daten verwenden“. Öffne Fokus möglichst nur auf einem Gerät gleichzeitig."
    >
      <Row
        title="Datenordner"
        desc={
          <span className="code" style={{ userSelect: "text", wordBreak: "break-all" }}>
            {storage?.dataDir ?? "–"}
          </span>
        }
      >
        <div className="col" style={{ alignItems: "flex-end", flex: "none" }}>
          <button className="btn" disabled={!isTauri || busy} onClick={() => void changeDir()}>
            <FolderOpen size={15} /> Ordner ändern …
          </button>
          <div className="row gap-4">
            {storage?.dataDir && isTauri && (
              <button className="btn sm ghost" onClick={() => void call("open_folder", { path: storage.dataDir })}>
                Im Explorer öffnen
              </button>
            )}
            {!storage?.isDefault && isTauri && (
              <button className="btn sm ghost" onClick={() => void useDefault()}>
                Standardordner
              </button>
            )}
          </div>
        </div>
      </Row>
      <Row
        title={
          <span className="row gap-4">
            <Laptop size={14} /> Dieses Gerät
          </span>
        }
        desc={otherDevice ? `Achtung: Fokus ist gerade auch auf „${otherDevice}“ geöffnet.` : "Kein anderes Gerät aktiv."}
      >
        <span className="badge">{device}</span>
      </Row>
      <div className="setting" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div className="setting-text">
          <span>Automatische Sicherungen</span>
          <span className="desc">Einmal täglich, die letzten 14 Tage werden aufbewahrt.</span>
        </div>
        {backups.length ? (
          <div className="list mt-8">
            {backups.slice(0, 7).map((b) => (
              <div key={b.file} className="list-item">
                <span className="grow small">
                  {b.file.match(/\d{4}-\d{2}-\d{2}/) ? fmtDate(b.file.match(/\d{4}-\d{2}-\d{2}/)![0], { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : b.file}
                </span>
                <button className="btn sm ghost" onClick={() => void restore(b)}>
                  Wiederherstellen
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="tiny faint mt-8">Noch keine Sicherungen vorhanden.</p>
        )}
      </div>
      <Row title="Export & Import" desc="Alle Daten als JSON-Datei sichern oder übertragen.">
        <div className="row">
          <button className="btn" disabled={!isTauri} onClick={() => void exportJson()}>
            <Download size={15} /> Exportieren
          </button>
          <button className="btn" disabled={!isTauri} onClick={() => void importJson()}>
            <Upload size={15} /> Importieren
          </button>
        </div>
      </Row>
    </Section>
  );
}

function SystemSection() {
  const general = useSettings().general;
  const set = useSet();
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/plugin-autostart").then((a) => a.isEnabled().then(setAutostart).catch(() => setAutostart(false)));
  }, []);

  const toggleAutostart = async (v: boolean) => {
    const a = await import("@tauri-apps/plugin-autostart");
    try {
      if (v) await a.enable();
      else await a.disable();
      setAutostart(await a.isEnabled());
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <Section id="system" icon={<Monitor size={18} />} title="System">
      <Row title="Beim Schließen im Infobereich weiterlaufen" desc="Der Timer läuft weiter; über das Symbol neben der Uhr holst du Fokus zurück.">
        <Switch checked={general.closeToTray} onChange={(v) => set("general", { closeToTray: v })} />
      </Row>
      <Row title="Mit Windows starten" desc="Fokus startet minimiert im Infobereich (gilt nur für dieses Gerät).">
        <Switch checked={!!autostart} disabled={autostart === null} onChange={(v) => void toggleAutostart(v)} />
      </Row>
      <Row title="Automatisch nach Updates suchen" desc="Beim Start und danach alle paar Stunden. Installiert wird nur, wenn du zustimmst.">
        <Switch checked={general.autoUpdate} onChange={(v) => set("general", { autoUpdate: v })} />
      </Row>
      <UpdateRow />
    </Section>
  );
}

function UpdateRow() {
  const { currentVersion, status, available, error, progress } = useUpdate();
  useEffect(() => {
    void loadCurrentVersion();
  }, []);
  const busy = status === "downloading" || status === "installing";
  const desc =
    status === "checking"
      ? "Suche nach Updates …"
      : busy
        ? `Update wird ${status === "installing" ? "installiert" : `heruntergeladen (${Math.round(progress * 100)} %)`} …`
        : available
          ? `Version ${available.version} ist verfügbar.`
          : status === "uptodate"
            ? "Du hast die neueste Version."
            : error ?? "Updates kommen direkt von GitHub und sind signiert.";
  return (
    <Row title={`Version ${currentVersion ?? "–"}`} desc={desc}>
      <div className="row">
        {available && !busy ? (
          <button className="btn primary" onClick={() => void installUpdate()}>
            <Download size={15} /> Jetzt aktualisieren
          </button>
        ) : (
          <button className="btn" disabled={!isTauri || status === "checking" || busy} onClick={() => void checkForUpdates(true)}>
            <RefreshCw size={15} /> Nach Updates suchen
          </button>
        )}
      </div>
    </Row>
  );
}
