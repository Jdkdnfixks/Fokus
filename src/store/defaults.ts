import type { AppData, EventType, Settings, TimerPreset } from "./types";

/**
 * Gedeckte Modulfarben in fester Reihenfolge. Die Reihenfolge ist so gewählt,
 * dass benachbarte Farben auch bei Rot-Grün-Schwäche unterscheidbar bleiben
 * (geprüft für hellen und dunklen Modus). Module bekommen sie der Reihe nach.
 */
export const MODULE_COLORS = [
  "#3e8751", // Salbei
  "#9280c5", // Lavendel
  "#9f524d", // Ziegel
  "#468fc8", // Taubenblau
  "#b86d8b", // Altrosa
  "#856100", // Ocker
  "#149892", // Petrol
  "#ab6443", // Ton
];

/** Termintypen – Farben aus derselben Palette, Reihenfolge = Legende */
export const EVENT_TYPES: Record<EventType, { label: string; color: string }> = {
  study: { label: "Lernblock", color: "#3e8751" },
  exercise: { label: "Übung", color: "#9280c5" },
  exam: { label: "Klausur", color: "#9f524d" },
  lecture: { label: "Vorlesung", color: "#468fc8" },
  deadline: { label: "Abgabe", color: "#b86d8b" },
  private: { label: "Privat", color: "#8a8f88" },
};

export const DEFAULT_PRESETS: TimerPreset[] = [
  { id: "p-25", name: "Klassisch", focus: 25, shortBreak: 5, longBreak: 20, longEvery: 4 },
  { id: "p-50", name: "Deep Work", focus: 50, shortBreak: 10, longBreak: 30, longEvery: 3 },
  { id: "p-90", name: "Lange Einheit", focus: 90, shortBreak: 20, longBreak: 30, longEvery: 0 },
];

export const DEFAULT_BLOCKLIST = [
  "youtube.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "netflix.com",
];

export function defaultSettings(): Settings {
  return {
    theme: "system",
    accent: "salbei",
    timer: {
      focus: 50,
      shortBreak: 10,
      longBreak: 30,
      longEvery: 3,
      autoStartBreak: true,
      autoStartFocus: false,
      sound: "glocke",
      soundVolume: 0.6,
      notifications: true,
      reflection: true,
      presets: DEFAULT_PRESETS,
    },
    music: {
      couple: true,
      focusSource: "none",
      localPlaylistId: null,
      spotifyUri: null,
      breakBehavior: "pause",
      fadeSeconds: 3,
      ambientInFocus: false,
      ambientInBreak: false,
      ambientMix: { rain: 0.5 },
      ambientMaster: 0.7,
      localVolume: 0.8,
    },
    spotify: { clientId: "" },
    blocker: {
      enabled: false,
      domains: DEFAULT_BLOCKLIST,
      blockInBreaks: false,
    },
    general: {
      closeToTray: true,
      dayStartHour: 7,
      dayEndHour: 22,
    },
  };
}

export function emptyData(): AppData {
  return {
    schema: 1,
    meta: { revision: 0, savedAt: new Date().toISOString(), savedBy: "" },
    modules: [],
    tasks: [],
    sessions: [],
    events: [],
    examPlans: [],
    tracks: [],
    playlists: [],
    feeds: [],
    settings: defaultSettings(),
  };
}

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Übernimmt gespeicherte Werte über die Standardwerte (für neue Einstellungen in späteren Versionen). */
function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (!isPlain(defaults) || !isPlain(stored)) return (stored === undefined ? defaults : stored) as T;
  const out: Plain = { ...defaults };
  for (const [k, v] of Object.entries(stored)) {
    const d = (defaults as Plain)[k];
    out[k] = isPlain(d) && isPlain(v) ? mergeDefaults(d, v) : v;
  }
  return out as T;
}

/** Macht aus eingelesenem JSON einen vollständigen, gültigen Datenstand. */
export function normalizeData(raw: unknown): AppData {
  const base = emptyData();
  if (!isPlain(raw)) return base;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const meta = isPlain(raw.meta) ? (raw.meta as AppData["meta"]) : base.meta;
  return {
    schema: 1,
    meta: { revision: Number(meta.revision) || 0, savedAt: String(meta.savedAt ?? ""), savedBy: String(meta.savedBy ?? "") },
    modules: arr(raw.modules),
    tasks: arr(raw.tasks),
    sessions: arr(raw.sessions),
    events: arr(raw.events),
    examPlans: arr(raw.examPlans),
    tracks: arr(raw.tracks),
    playlists: arr(raw.playlists),
    feeds: arr(raw.feeds),
    settings: mergeDefaults(base.settings, raw.settings),
  };
}
