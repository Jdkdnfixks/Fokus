import { create } from "zustand";
import { call, errorText, isTauri } from "../lib/tauri";
import { emptyData, normalizeData } from "./defaults";
import { currentRevision, dailyBackup, heartbeat, loadRaw, saveRaw, storageInfo, type StorageInfo } from "./persistence";
import type {
  AppData,
  CalEvent,
  ExamPlan,
  ID,
  IcalFeed,
  LocalPlaylist,
  LocalTrack,
  Module,
  Session,
  Settings,
  Task,
} from "./types";

export interface Collections {
  modules: Module;
  tasks: Task;
  sessions: Session;
  events: CalEvent;
  examPlans: ExamPlan;
  tracks: LocalTrack;
  playlists: LocalPlaylist;
  feeds: IcalFeed;
}
export type CollectionKey = keyof Collections;

type Status = "loading" | "ready" | "missing-dir" | "error";

interface DataState {
  status: Status;
  data: AppData;
  /** Revision, auf der der aktuelle Stand beruht */
  revision: number;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  error: string | null;
  storage: StorageInfo | null;
  otherDevice: string | null;
  device: string;

  init(): Promise<void>;
  reload(): Promise<void>;
  flush(force?: boolean): Promise<void>;
  resolveConflict(keep: "mine" | "theirs"): Promise<void>;
  replaceData(next: AppData): void;

  upsert<K extends CollectionKey>(key: K, item: Collections[K]): void;
  upsertMany<K extends CollectionKey>(key: K, items: Collections[K][]): void;
  patch<K extends CollectionKey>(key: K, id: ID, partial: Partial<Collections[K]>): void;
  remove<K extends CollectionKey>(key: K, ids: ID | ID[]): void;
  setCollection<K extends CollectionKey>(key: K, items: Collections[K][]): void;
  setSettings(recipe: (s: Settings) => Settings): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveAgain = false;
const SAVE_DELAY = 700;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void useData.getState().flush();
  }, SAVE_DELAY);
}

function mutate(fn: (d: AppData) => AppData) {
  useData.setState((s) => ({ data: fn(s.data), dirty: true }));
  scheduleSave();
}

export const useData = create<DataState>()((set, get) => ({
  status: "loading",
  data: emptyData(),
  revision: 0,
  dirty: false,
  saving: false,
  conflict: false,
  error: null,
  storage: null,
  otherDevice: null,
  device: "Browser",

  async init() {
    try {
      const storage = await storageInfo();
      set({ storage, device: storage.device });
      if (!storage.dataDir) {
        set({ status: "missing-dir" });
        return;
      }
      await get().reload();
      if (get().status !== "ready") return;
      void dailyBackup().catch(() => {});
      startBackgroundChecks();
    } catch (e) {
      set({ status: "error", error: errorText(e) });
    }
  },

  async reload() {
    const res = await loadRaw();
    let data = emptyData();
    if (res.content) {
      try {
        data = normalizeData(JSON.parse(res.content));
      } catch (e) {
        set({
          status: "error",
          error: `Die Datendatei ist beschädigt (${errorText(e)}). Du kannst in den Einstellungen eine Sicherung wiederherstellen.`,
        });
        return;
      }
    }
    set({ data, revision: res.revision, dirty: false, conflict: false, status: "ready", error: null });
  },

  async flush(force = false) {
    const state = get();
    if (state.status !== "ready") return;
    if (!state.dirty && !force) return;
    if (state.conflict && !force) return;
    if (state.saving) {
      saveAgain = true;
      return;
    }
    const snapshot = state.data;
    const next: AppData = {
      ...snapshot,
      meta: { revision: state.revision + 1, savedAt: new Date().toISOString(), savedBy: state.device },
    };
    set({ saving: true });
    try {
      const res = await saveRaw(next, state.revision, force);
      if (res.conflict) {
        set({ conflict: true, saving: false });
        return;
      }
      set((s) => ({
        revision: res.currentRevision,
        saving: false,
        dirty: s.data !== snapshot,
        error: null,
      }));
    } catch (e) {
      set({ saving: false, error: `Speichern fehlgeschlagen: ${errorText(e)}` });
      return;
    }
    if (saveAgain || get().dirty) {
      saveAgain = false;
      scheduleSave();
    }
  },

  async resolveConflict(keep) {
    if (keep === "theirs") {
      await get().reload();
    } else {
      set({ conflict: false, dirty: true });
      await get().flush(true);
    }
  },

  replaceData(next) {
    set({ data: normalizeData(next), dirty: true });
    scheduleSave();
  },

  upsert(key, item) {
    mutate((d) => {
      const list = d[key] as Collections[typeof key][];
      const idx = list.findIndex((x) => x.id === item.id);
      const nextList = idx >= 0 ? list.map((x, i) => (i === idx ? item : x)) : [...list, item];
      return { ...d, [key]: nextList };
    });
  },

  upsertMany(key, items) {
    if (!items.length) return;
    mutate((d) => {
      const list = d[key] as Collections[typeof key][];
      const byId = new Map(items.map((i) => [i.id, i]));
      const updated = list.map((x) => byId.get(x.id) ?? x);
      const existing = new Set(list.map((x) => x.id));
      const added = items.filter((i) => !existing.has(i.id));
      return { ...d, [key]: [...updated, ...added] };
    });
  },

  patch(key, id, partial) {
    mutate((d) => {
      const list = d[key] as Collections[typeof key][];
      return { ...d, [key]: list.map((x) => (x.id === id ? { ...x, ...partial } : x)) };
    });
  },

  remove(key, ids) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    mutate((d) => {
      const list = d[key] as Collections[typeof key][];
      return { ...d, [key]: list.filter((x) => !idSet.has(x.id)) };
    });
  },

  setCollection(key, items) {
    mutate((d) => ({ ...d, [key]: items }));
  },

  setSettings(recipe) {
    mutate((d) => ({ ...d, settings: recipe(d.settings) }));
  },
}));

/** Kurzform für Komponenten: nur die Einstellungen abonnieren */
export const useSettings = () => useData((s) => s.data.settings);

let backgroundStarted = false;

/**
 * Hintergrundprüfungen für den Cloud-Ordner:
 * - Lock-Markierung erneuern / anderes Gerät erkennen
 * - Änderungen von anderen Geräten nachladen
 */
function startBackgroundChecks() {
  if (backgroundStarted || !isTauri) return;
  backgroundStarted = true;

  const beat = async () => {
    try {
      const lock = await heartbeat();
      useData.setState({ otherDevice: lock.otherDevice });
    } catch {
      /* Ordner kurzzeitig nicht erreichbar */
    }
  };

  const checkExternal = async () => {
    const s = useData.getState();
    if (s.status !== "ready" || s.saving) return;
    try {
      const rev = await currentRevision();
      if (rev > s.revision) {
        if (s.dirty) useData.setState({ conflict: true });
        else await s.reload();
      }
    } catch {
      /* ignorieren */
    }
  };

  void beat();
  setInterval(beat, 60_000);
  setInterval(checkExternal, 20_000);
  window.addEventListener("focus", () => void checkExternal());
}

/** Vor dem Beenden: ausstehende Änderungen sofort speichern. */
export async function flushBeforeQuit() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await useData.getState().flush();
}

export async function releaseLock() {
  if (isTauri) await call("lock_release").catch(() => {});
}
