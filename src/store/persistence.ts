import { call, isTauri } from "../lib/tauri";
import type { AppData } from "./types";

const BROWSER_KEY = "fokus-daten";

export interface StorageInfo {
  dataDir: string | null;
  defaultDir: string;
  missingDir: string | null;
  device: string;
  musicDir: string | null;
  isDefault: boolean;
}

export interface LoadResult {
  content: string | null;
  revision: number;
}

export interface SaveResult {
  ok: boolean;
  conflict: boolean;
  currentRevision: number;
}

export interface LockStatus {
  otherDevice: string | null;
  otherHeartbeat: number | null;
}

export async function storageInfo(): Promise<StorageInfo> {
  if (!isTauri) {
    return { dataDir: "Browser-Speicher", defaultDir: "Browser-Speicher", missingDir: null, device: "Browser", musicDir: null, isDefault: true };
  }
  return call<StorageInfo>("storage_info");
}

export async function loadRaw(): Promise<LoadResult> {
  if (!isTauri) {
    const content = localStorage.getItem(BROWSER_KEY);
    let revision = 0;
    try {
      revision = content ? Number(JSON.parse(content)?.meta?.revision) || 0 : 0;
    } catch {
      /* ignorieren */
    }
    return { content, revision };
  }
  return call<LoadResult>("data_load");
}

export async function saveRaw(data: AppData, baseRevision: number, force: boolean): Promise<SaveResult> {
  const content = JSON.stringify(data);
  if (!isTauri) {
    localStorage.setItem(BROWSER_KEY, content);
    return { ok: true, conflict: false, currentRevision: data.meta.revision };
  }
  return call<SaveResult>("data_save", { content, baseRevision, force });
}

export async function currentRevision(): Promise<number> {
  if (!isTauri) return -1;
  return call<number>("data_revision");
}

export async function heartbeat(): Promise<LockStatus> {
  if (!isTauri) return { otherDevice: null, otherHeartbeat: null };
  return call<LockStatus>("lock_heartbeat");
}

export async function dailyBackup(): Promise<void> {
  if (!isTauri) return;
  await call("data_backup");
}
