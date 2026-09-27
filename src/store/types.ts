export type ID = string;

/** Lokales Datum im Format YYYY-MM-DD */
export type DateStr = string;
/** Lokale Uhrzeit mit Datum im Format YYYY-MM-DDTHH:mm */
export type LocalDateTime = string;

export interface Module {
  id: ID;
  name: string;
  short?: string;
  color: string;
  ects?: number;
  semester?: string;
  examDate?: DateStr;
  examTime?: string;
  /** Wochenziel in Minuten (0 = kein Ziel) */
  weeklyGoalMinutes: number;
  notes?: string;
  archived: boolean;
  createdAt: string;
}

export interface Task {
  id: ID;
  moduleId: ID | null;
  title: string;
  notes?: string;
  /** Geschätzte Anzahl Pomodoros */
  estimate: number;
  done: boolean;
  doneAt?: string;
  dueDate?: DateStr;
  createdAt: string;
}

export interface Session {
  id: ID;
  moduleId: ID | null;
  taskId: ID | null;
  /** ISO-Zeitstempel */
  start: string;
  end: string;
  /** Tatsächlich fokussierte Minuten (ohne Pausenzeiten) */
  focusMinutes: number;
  plannedMinutes: number;
  /** true, wenn die Lernphase vollständig durchlaufen wurde */
  completed: boolean;
  /** Konzentration 1–5 aus der Reflexion */
  rating?: number;
  note?: string;
}

export type EventType = "lecture" | "exercise" | "study" | "exam" | "deadline" | "private";

export interface Recurrence {
  freq: "weekly";
  /** alle n Wochen */
  interval: number;
  /** Wochentage 0 = So … 6 = Sa; leer = Wochentag des Starts */
  byDay?: number[];
  until?: DateStr;
}

export interface CalEvent {
  id: ID;
  title: string;
  type: EventType;
  start: LocalDateTime;
  end: LocalDateTime;
  allDay: boolean;
  moduleId: ID | null;
  location?: string;
  notes?: string;
  recurrence?: Recurrence;
  /** Ausgelassene Termine einer Serie (Datum des Vorkommens) */
  exdates?: DateStr[];
  source?: {
    kind: "ical" | "planner";
    /** iCal-UID bzw. Kalendername */
    ref?: string;
    feed?: string;
    planId?: ID;
    chapterId?: ID;
  };
}

export interface Chapter {
  id: ID;
  title: string;
  /** geschätzte Lernblöcke */
  blocks: number;
  done: boolean;
}

export interface ExamPlanSettings {
  blockMinutes: number;
  breakMinutes: number;
  maxBlocksPerDay: number;
  /** erlaubte Wochentage 0 = So … 6 = Sa */
  days: number[];
  dayStart: string;
  dayEnd: string;
  /** Tage vor der Klausur, die nur für Wiederholung genutzt werden */
  reviewDays: number;
  reviewBlocks: number;
  startDate?: DateStr;
}

export interface ExamPlan {
  id: ID;
  moduleId: ID;
  chapters: Chapter[];
  settings: ExamPlanSettings;
  generatedAt?: string;
}

export interface LocalTrack {
  id: ID;
  /** Dateiname im Musikordner */
  file: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  /** gemessene Lautheit in LUFS (null = nicht messbar, fehlt = noch nicht gemessen) */
  loudness?: number | null;
  addedAt: string;
}

export interface LocalPlaylist {
  id: ID;
  name: string;
  trackIds: ID[];
}

export interface IcalFeed {
  id: ID;
  name: string;
  url: string;
  type: EventType;
  moduleId: ID | null;
  lastSync?: string;
}

export interface TimerPreset {
  id: ID;
  name: string;
  focus: number;
  shortBreak: number;
  longBreak: number;
  longEvery: number;
}

export type ThemeMode = "system" | "light" | "dark";
export type Accent = "salbei" | "see" | "lavendel" | "sand";
export type ChimeSound = "glocke" | "holz" | "sanft" | "aus";
export type AmbientId = "rain" | "wind" | "waves" | "fire" | "brown" | "pink" | "white" | "stream";

export interface Settings {
  theme: ThemeMode;
  accent: Accent;
  timer: {
    focus: number;
    shortBreak: number;
    longBreak: number;
    /** Lerneinheiten pro Durchgang (0 = ohne Ende); danach lange Pause bzw. Stopp */
    longEvery: number;
    /** Phasen innerhalb eines Durchgangs automatisch nacheinander starten */
    autoContinue: boolean;
    sound: ChimeSound;
    soundVolume: number;
    /** Ton in jeder der letzten 5 Sekunden einer Phase */
    countdownTicks: boolean;
    notifications: boolean;
    reflection: boolean;
    presets: TimerPreset[];
  };
  music: {
    couple: boolean;
    focusSource: "none" | "local" | "spotify";
    /** true, sobald die Quelle bewusst gewählt wurde (sonst wählt Fokus eigene Musik automatisch) */
    sourceChosen: boolean;
    localPlaylistId: ID | null;
    spotifyUri: string | null;
    spotifyName?: string;
    /** Musik in den Pausen: Lernmusik pausieren, weiterlaufen lassen oder eigene Pausenmusik */
    breakSource: "pause" | "continue" | "local" | "spotify";
    breakLocalPlaylistId: ID | null;
    breakSpotifyUri: string | null;
    breakSpotifyName?: string;
    fadeSeconds: number;
    ambientInFocus: boolean;
    ambientInBreak: boolean;
    ambientMix: Partial<Record<AmbientId, number>>;
    ambientMaster: number;
    /** Musiklautstärke 0–1 (logarithmisch wie bei Spotify) */
    volume: number;
    /** eigene Titel auf denselben Pegel bringen */
    normalize: boolean;
    /** Spotify folgt demselben Lautstärkeregler */
    linkVolume: boolean;
    /** in Spotify eingestellter Lautstärkepegel (Normalisierung) */
    loudnessTarget: "quiet" | "normal" | "loud";
    /** Feinabgleich: + = Spotify lauter als eigene Musik, − = leiser (dB) */
    spotifyOffsetDb: number;
  };
  spotify: {
    clientId: string;
  };
  blocker: {
    enabled: boolean;
    domains: string[];
    blockInBreaks: boolean;
  };
  general: {
    closeToTray: boolean;
    /** automatisch nach neuen Versionen suchen */
    autoUpdate: boolean;
    dayStartHour: number;
    dayEndHour: number;
  };
}

export interface AppData {
  schema: 1;
  meta: {
    revision: number;
    savedAt: string;
    savedBy: string;
  };
  modules: Module[];
  tasks: Task[];
  sessions: Session[];
  events: CalEvent[];
  examPlans: ExamPlan[];
  tracks: LocalTrack[];
  playlists: LocalPlaylist[];
  feeds: IcalFeed[];
  settings: Settings;
}
