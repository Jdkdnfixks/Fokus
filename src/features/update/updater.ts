import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { call, errorText, isTauri } from "../../lib/tauri";
import { flushBeforeQuit, useData } from "../../store/data";
import { useTimer } from "../timer/timerStore";

/**
 * Automatische Updates: Fokus fragt bei GitHub nach, ob es eine neuere,
 * signierte Version gibt, lädt sie auf Wunsch herunter und installiert sie.
 * Deine Daten liegen getrennt vom Programm und bleiben erhalten.
 */

type Status = "idle" | "checking" | "uptodate" | "downloading" | "installing" | "error";

interface UpdateState {
  status: Status;
  currentVersion: string | null;
  available: { version: string; notes?: string; date?: string } | null;
  progress: number;
  error: string | null;
  /** Version, bei der der Hinweis mit „Später“ ausgeblendet wurde */
  snoozed: string | null;
  lastCheck: number | null;
}

export const useUpdate = create<UpdateState>()(() => ({
  status: "idle",
  currentVersion: null,
  available: null,
  progress: 0,
  error: null,
  snoozed: null,
  lastCheck: null,
}));

let pending: Update | null = null;

export async function loadCurrentVersion() {
  if (!isTauri) return;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    useUpdate.setState({ currentVersion: await getVersion() });
  } catch {
    /* ohne Version geht es auch */
  }
}

/** Sucht nach einer neuen Version. Fehler werden nur bei manueller Suche angezeigt. */
export async function checkForUpdates(manual = false): Promise<boolean> {
  if (!isTauri) {
    if (manual) useUpdate.setState({ status: "error", error: "Updates gibt es nur in der Desktop-App." });
    return false;
  }
  const s = useUpdate.getState();
  if (s.status === "checking" || s.status === "downloading" || s.status === "installing") return false;
  useUpdate.setState({ status: "checking", error: null });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 30_000 });
    pending = update;
    if (update) {
      useUpdate.setState({
        status: "idle",
        available: { version: update.version, notes: update.body ?? undefined, date: update.date ?? undefined },
        lastCheck: Date.now(),
        ...(manual ? { snoozed: null } : {}),
      });
      return true;
    }
    useUpdate.setState({ status: "uptodate", available: null, lastCheck: Date.now() });
    return false;
  } catch (e) {
    useUpdate.setState({
      status: manual ? "error" : "idle",
      error: manual ? `Suche fehlgeschlagen: ${errorText(e)}` : null,
      lastCheck: Date.now(),
    });
    return false;
  }
}

/** Lädt das Update herunter, sichert vorher alles und startet Fokus neu. */
export async function installUpdate() {
  if (!pending) return;
  // Vorher: laufende Lernzeit erfassen, Daten speichern, Sperren aufheben
  useTimer.getState().captureForQuit();
  await flushBeforeQuit().catch(() => {});
  await call("blocker_clear").catch(() => {});
  await call("lock_release").catch(() => {});

  useUpdate.setState({ status: "downloading", progress: 0, error: null });
  let total = 0;
  let done = 0;
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        done += event.data.chunkLength;
        useUpdate.setState({ progress: total ? Math.min(1, done / total) : 0 });
      } else if (event.event === "Finished") useUpdate.setState({ status: "installing", progress: 1 });
    });
    // Unter Windows beendet der Installer Fokus selbst und startet es danach neu.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdate.setState({ status: "error", error: `Update fehlgeschlagen: ${errorText(e)}` });
  }
}

export function snoozeUpdate() {
  const v = useUpdate.getState().available?.version ?? null;
  useUpdate.setState({ snoozed: v });
}

let started = false;
/** Beim Start (verzögert) und danach alle 6 Stunden nach Updates suchen. */
export function startUpdateChecks() {
  if (started || !isTauri) return;
  started = true;
  void loadCurrentVersion();
  const auto = () => useData.getState().data.settings.general.autoUpdate;
  setTimeout(() => {
    if (auto()) void checkForUpdates(false);
  }, 8000);
  setInterval(() => {
    if (auto()) void checkForUpdates(false);
  }, 6 * 3600_000);
}
