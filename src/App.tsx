import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CloudOff,
  FolderOpen,
  ListTodo,
  Music,
  Pause,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { ConfirmHost, ToastHost } from "./components/ui";
import { CalendarPage } from "./features/calendar/CalendarPage";
import { ModulesPage } from "./features/modules/ModulesPage";
import { MusicPage } from "./features/music/MusicPage";
import { NowPlaying } from "./features/music/NowPlaying";
import { setMusicDir } from "./features/music/localPlayer";
import { startSpotifyPolling } from "./features/music/spotify";
import { SettingsPage } from "./features/settings/SettingsPage";
import { StatsPage } from "./features/stats/StatsPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { startTimerEngine } from "./features/timer/engine";
import { MiniTimer } from "./features/timer/MiniTimer";
import { ReflectionDialog } from "./features/timer/ReflectionDialog";
import { PHASE_COLOR, TimerPage } from "./features/timer/TimerPage";
import { PHASE_LABEL, remainingNow, useTimer } from "./features/timer/timerStore";
import { call, errorText, isTauri, onBackendEvent } from "./lib/tauri";
import { notify } from "./lib/notify";
import { fmtClock } from "./lib/time";
import { useNow } from "./lib/useNow";
import { showMainWindow } from "./lib/window";
import { flushBeforeQuit, useData, useSettings } from "./store/data";
import { useNav, type Page } from "./store/nav";
import type { StorageInfo } from "./store/persistence";
import { refreshBlockerStatus } from "./features/blocker/blocker";
import { autoSyncFeeds } from "./features/calendar/ImportDialog";

const NAV: { page: Page; label: string; icon: typeof Timer }[] = [
  { page: "timer", label: "Fokus", icon: Timer },
  { page: "calendar", label: "Kalender", icon: CalendarDays },
  { page: "tasks", label: "Aufgaben", icon: ListTodo },
  { page: "modules", label: "Module", icon: BookOpen },
  { page: "stats", label: "Statistik", icon: BarChart3 },
  { page: "music", label: "Musik", icon: Music },
];

export default function App() {
  const status = useData((s) => s.status);
  const mini = useTimer((s) => s.mini);
  useTheme();
  useStartup();

  if (status === "loading") return <div className="boot" />;
  if (status === "missing-dir") return <MissingDirScreen />;
  if (status === "error") return <ErrorScreen />;

  if (mini) return <MiniTimer />;

  return (
    <>
      <div className="app">
        <Sidebar />
        <main className="main">
          <AppBanners />
          <CurrentPage />
        </main>
      </div>
      <ReflectionDialog />
      <ConfirmHost />
      <ToastHost />
    </>
  );
}

function CurrentPage() {
  const page = useNav((s) => s.page);
  switch (page) {
    case "timer":
      return <TimerPage />;
    case "calendar":
      return <CalendarPage />;
    case "tasks":
      return <TasksPage />;
    case "modules":
      return <ModulesPage />;
    case "stats":
      return <StatsPage />;
    case "music":
      return <MusicPage />;
    case "settings":
      return <SettingsPage />;
  }
}

function Sidebar() {
  const page = useNav((s) => s.page);
  const navigate = useNav((s) => s.navigate);
  const openTasks = useData((s) => s.data.tasks.filter((t) => !t.done).length);

  return (
    <nav className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Timer size={16} />
        </span>
        <span className="brand-name">Fokus</span>
      </div>
      <div className="nav">
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <button key={p} className={`nav-item ${page === p ? "active" : ""}`} onClick={() => navigate(p)} title={label}>
            <Icon size={18} />
            <span className="nav-label">{label}</span>
            {p === "tasks" && openTasks > 0 && <span className="nav-badge">{openTasks}</span>}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <SideTimer />
        <NowPlaying />
        <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => navigate("settings")} title="Einstellungen">
          <SettingsIcon size={18} />
          <span className="nav-label">Einstellungen</span>
        </button>
      </div>
    </nav>
  );
}

function SideTimer() {
  const t = useTimer();
  const page = useNav((s) => s.page);
  const navigate = useNav((s) => s.navigate);
  const now = useNow(1000, t.status === "running");
  if (t.status === "idle" || page === "timer") return null;
  return (
    <div className="side-widget">
      <span className="label" style={{ color: PHASE_COLOR[t.phase] }}>
        {PHASE_LABEL[t.phase]}
      </span>
      <div className="side-timer" onClick={() => navigate("timer")}>
        <span className="time tabular">{fmtClock(remainingNow(t, now))}</span>
        <button
          className="icon-btn sm"
          onClick={(e) => {
            e.stopPropagation();
            t.toggle();
          }}
        >
          {t.status === "running" ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </div>
    </div>
  );
}

function AppBanners() {
  const conflict = useData((s) => s.conflict);
  const otherDevice = useData((s) => s.otherDevice);
  const error = useData((s) => s.error);
  const resolve = useData((s) => s.resolveConflict);
  return (
    <>
      {conflict && (
        <div className="banner danger app-banner">
          <TriangleAlert size={16} />
          <span className="grow">
            Auf einem anderen Gerät wurden Änderungen gespeichert, während hier ebenfalls etwas geändert wurde. Welcher Stand soll gelten?
          </span>
          <button className="btn sm" onClick={() => void resolve("theirs")}>
            Stand des anderen Geräts laden
          </button>
          <button className="btn sm primary" onClick={() => void resolve("mine")}>
            Meinen Stand behalten
          </button>
        </div>
      )}
      {!conflict && otherDevice && (
        <div className="banner app-banner">
          <TriangleAlert size={16} />
          <span>
            Fokus scheint gerade auch auf <strong>{otherDevice}</strong> geöffnet zu sein. Schließe die App dort, damit sich eure Änderungen
            nicht überschneiden.
          </span>
        </div>
      )}
      {error && !conflict && (
        <div className="banner danger app-banner">
          <CloudOff size={16} />
          <span>{error}</span>
        </div>
      )}
    </>
  );
}

function useTheme() {
  const settings = useSettings();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const theme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = settings.accent;
  }, [theme, settings.accent]);
}

let startupDone = false;

function useStartup() {
  const status = useData((s) => s.status);
  const storage = useData((s) => s.storage);
  const closeToTray = useSettings().general.closeToTray;

  useEffect(() => {
    if (startupDone) return;
    startupDone = true;
    void useData.getState().init();
    void onBackendEvent("app://hidden-to-tray", () => {
      try {
        if (localStorage.getItem("fokus-tray-hinweis")) return;
        localStorage.setItem("fokus-tray-hinweis", "1");
      } catch {
        /* egal */
      }
      void notify(
        "Fokus läuft im Hintergrund weiter",
        "Über das Symbol im Infobereich (neben der Uhr) holst du Fokus zurück. Beenden: Rechtsklick → Beenden.",
      );
    });
    void onBackendEvent("app://quit-requested", async () => {
      useTimer.getState().captureForQuit();
      await flushBeforeQuit().catch(() => {});
      await call("quit_app").catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    startTimerEngine();
    startSpotifyPolling();
    void refreshBlockerStatus();
    void autoSyncFeeds();
  }, [status]);

  useEffect(() => {
    setMusicDir(storage?.musicDir ?? null);
  }, [storage?.musicDir]);

  useEffect(() => {
    if (isTauri && status === "ready") void call("set_close_to_tray", { enabled: closeToTray }).catch(() => {});
  }, [closeToTray, status]);
}

function MissingDirScreen() {
  const storage = useData((s) => s.storage);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<StorageInfo>) => {
    setBusy(true);
    setErr(null);
    try {
      const info = await fn();
      useData.setState({ storage: info });
      if (info.dataDir) await useData.getState().init();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Datenordner wählen" });
    if (typeof dir === "string") await run(() => call<StorageInfo>("storage_set_dir", { path: dir, mode: "use-existing" }));
  };

  useEffect(() => {
    void showMainWindow();
  }, []);

  return (
    <div className="center-screen">
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="col gap-12">
          <h2 className="row">
            <CloudOff size={20} /> Datenordner nicht erreichbar
          </h2>
          <p className="muted">
            Fokus speichert deine Daten in <span className="code">{storage?.missingDir}</span>. Dieser Ordner ist gerade nicht verfügbar,
            zum Beispiel weil OneDrive oder Sciebo noch nicht gestartet ist.
          </p>
          {err && <div className="banner danger">{err}</div>}
          <div className="row wrap mt-8">
            <button className="btn primary" disabled={busy} onClick={() => void run(() => call<StorageInfo>("storage_retry"))}>
              <RefreshCw size={15} /> Erneut versuchen
            </button>
            <button className="btn" disabled={busy} onClick={() => void choose()}>
              <FolderOpen size={15} /> Anderen Ordner wählen
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => void run(() => call<StorageInfo>("storage_use_default"))}>
              Lokalen Standardordner nutzen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen() {
  const error = useData((s) => s.error);
  const navigate = useNav((s) => s.navigate);
  useEffect(() => {
    void showMainWindow();
  }, []);
  return (
    <div className="center-screen">
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="col gap-12">
          <h2 className="row">
            <TriangleAlert size={20} /> Daten konnten nicht geladen werden
          </h2>
          <p className="muted">{error}</p>
          <div className="row">
            <button className="btn primary" onClick={() => void useData.getState().init()}>
              <RefreshCw size={15} /> Erneut versuchen
            </button>
            <button
              className="btn"
              onClick={() => {
                useData.setState({ status: "ready", error: null });
                navigate("settings", "data");
              }}
            >
              Sicherung wiederherstellen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
