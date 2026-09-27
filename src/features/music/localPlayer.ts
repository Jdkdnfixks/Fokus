import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/tauri";
import { useData } from "../../store/data";
import type { ID, LocalTrack } from "../../store/types";
import { localVolumeFor } from "./volume";

export type Repeat = "off" | "all" | "one";

/** Gemerkter Stand der Lernmusik, während in der Pause etwas anderes läuft */
export interface LocalSnapshot {
  queue: ID[];
  index: number;
  position: number;
  playlistId: ID | null;
}

interface LocalPlayerState {
  queue: ID[];
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  playlistId: ID | null;
  shuffle: boolean;
  repeat: Repeat;
  error: string | null;

  /** Playlist abspielen; mit `fade` > 0 wird vom bisherigen Titel übergeblendet */
  playQueue(trackIds: ID[], startIndex?: number, playlistId?: ID | null, fade?: number): void;
  toggle(): void;
  resume(fade?: number): void;
  pause(fade?: number): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  setShuffle(v: boolean): void;
  setRepeat(r: Repeat): void;
  /** aktuellen Stand merken (null, wenn nichts geladen ist) */
  snapshot(): LocalSnapshot | null;
  /** gemerkten Stand wiederherstellen und an derselben Stelle weiterspielen (mit Überblendung) */
  restore(snap: LocalSnapshot, fade?: number): void;
}

/**
 * Der Player arbeitet mit bis zu zwei Audio-Elementen („Decks“): Beim Wechsel
 * der Musik wird das alte Deck ausgeblendet, während das neue eingeblendet wird
 * (Überblendung wie bei Spotify). `audio` ist immer das aktuelle Deck.
 */
let audio: HTMLAudioElement | null = null;
const ramps = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();
let musicDir: string | null = null;

export function setMusicDir(dir: string | null) {
  musicDir = dir;
}

export function trackUrl(track: LocalTrack): string | null {
  if (!isTauri || !musicDir) return null;
  const sep = musicDir.includes("\\") ? "\\" : "/";
  return convertFileSrc(`${musicDir}${sep}${track.file}`);
}

/** Lautstärke für den aktuellen Titel: Regler + Pegelausgleich des Titels */
function targetVolume() {
  return localVolumeFor(currentLocalTrack(), useData.getState().data.settings.music);
}

function createAudio(): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  el.addEventListener("timeupdate", () => {
    if (el === audio) useLocalPlayer.setState({ position: el.currentTime });
  });
  el.addEventListener("loadedmetadata", () => {
    if (el === audio) useLocalPlayer.setState({ duration: el.duration || 0 });
  });
  el.addEventListener("ended", () => {
    if (el !== audio) return;
    const s = useLocalPlayer.getState();
    if (s.repeat === "one") {
      el.currentTime = 0;
      void el.play();
    } else {
      advance(1, true);
    }
  });
  el.addEventListener("error", () => {
    if (el === audio && el.getAttribute("src")) {
      useLocalPlayer.setState({ error: "Titel konnte nicht abgespielt werden.", playing: false });
    }
  });
  return el;
}

function getAudio(): HTMLAudioElement {
  if (!audio) audio = createAudio();
  return audio;
}

function stopRamp(el: HTMLAudioElement) {
  const t = ramps.get(el);
  if (t) {
    clearInterval(t);
    ramps.delete(el);
  }
}

/** Blendet die Lautstärke eines Decks weich über `seconds` auf `to`. */
function ramp(el: HTMLAudioElement, to: number, seconds: number, done?: () => void) {
  stopRamp(el);
  if (seconds <= 0) {
    el.volume = to;
    done?.();
    return;
  }
  const from = el.volume;
  const start = performance.now();
  ramps.set(
    el,
    setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t >= 1) {
        stopRamp(el);
        done?.();
      }
    }, 50),
  );
}

function clearFade() {
  if (audio) stopRamp(audio);
}

function fadeTo(to: number, seconds: number, done?: () => void) {
  ramp(getAudio(), to, seconds, done);
}

/** Altes Deck ausblenden und freigeben */
function retire(el: HTMLAudioElement, seconds: number) {
  const finish = () => {
    el.pause();
    el.removeAttribute("src");
    el.load();
  };
  if (el.paused || seconds <= 0) {
    stopRamp(el);
    finish();
  } else {
    ramp(el, 0, seconds, finish);
  }
}

/** Setzt die Quelle eines Decks auf den Titel an Position `index` der Warteschlange. */
function loadInto(el: HTMLAudioElement, index: number): boolean {
  const s = useLocalPlayer.getState();
  const track = useData.getState().data.tracks.find((t) => t.id === s.queue[index]);
  if (!track) return false;
  const url = trackUrl(track);
  if (!url) {
    useLocalPlayer.setState({ error: "Musik lässt sich nur in der Desktop-App abspielen." });
    return false;
  }
  el.src = url;
  useLocalPlayer.setState({ index, position: 0, duration: track.duration ?? 0, error: null });
  return true;
}

/**
 * Überblendet auf ein neues Deck: Das bisherige wird über `seconds` leiser,
 * das neue startet (ggf. an `position`) und wird gleichzeitig lauter.
 */
function crossfadeTo(index: number, seconds: number, position = 0) {
  const old = audio;
  const next = createAudio();
  audio = next;
  if (old) retire(old, seconds);
  if (!loadInto(next, index)) return;
  next.volume = 0;
  const start = () => {
    if (position > 0) next.currentTime = Math.min(position, next.duration || position);
    void next
      .play()
      .then(() => {
        if (audio !== next) return;
        useLocalPlayer.setState({ playing: true });
        ramp(next, targetVolume(), seconds);
      })
      .catch(() => useLocalPlayer.setState({ playing: false }));
  };
  if (position > 0 && next.readyState < 1) {
    const onMeta = () => {
      next.removeEventListener("loadedmetadata", onMeta);
      start();
    };
    next.addEventListener("loadedmetadata", onMeta);
  } else start();
}

function loadIndex(index: number, autoplay: boolean) {
  const a = getAudio();
  stopRamp(a);
  if (!loadInto(a, index)) return;
  a.volume = targetVolume();
  if (autoplay) {
    void a
      .play()
      .then(() => useLocalPlayer.setState({ playing: true }))
      .catch(() => useLocalPlayer.setState({ playing: false }));
  }
}

function advance(dir: 1 | -1, auto = false) {
  const s = useLocalPlayer.getState();
  if (!s.queue.length) return;
  let next = s.index + dir;
  if (next >= s.queue.length) {
    if (s.repeat === "all" || !auto) next = 0;
    else {
      useLocalPlayer.setState({ playing: false });
      return;
    }
  }
  if (next < 0) next = s.queue.length - 1;
  loadIndex(next, auto || s.playing);
}

function shuffled<T>(arr: T[], first?: T): T[] {
  const a = arr.filter((x) => x !== first);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return first !== undefined ? [first, ...a] : a;
}

export const useLocalPlayer = create<LocalPlayerState>()((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  position: 0,
  duration: 0,
  playlistId: null,
  shuffle: false,
  repeat: "all",
  error: null,

  playQueue(trackIds, startIndex = 0, playlistId = null, fade = 0) {
    if (!trackIds.length) return;
    const first = trackIds[startIndex];
    const queue = get().shuffle ? shuffled(trackIds, first) : trackIds;
    set({ queue, playlistId, index: 0 });
    const index = get().shuffle ? 0 : startIndex;
    if (fade > 0) crossfadeTo(index, fade);
    else loadIndex(index, true);
  },

  toggle() {
    if (get().playing) get().pause();
    else get().resume();
  },

  resume(fade = 0) {
    const a = getAudio();
    clearFade(); // eine laufende Ausblendung (mit anschließendem Pausieren) abbrechen
    if (!a.src) {
      const s = get();
      if (s.queue.length) loadIndex(s.index, true);
      return;
    }
    a.volume = fade > 0 ? 0 : targetVolume();
    void a
      .play()
      .then(() => {
        set({ playing: true });
        if (fade > 0) fadeTo(targetVolume(), fade);
      })
      .catch(() => set({ playing: false }));
  },

  pause(fade = 0) {
    const a = getAudio();
    if (!get().playing) return;
    set({ playing: false });
    fadeTo(0, fade, () => {
      a.pause();
      a.volume = targetVolume();
    });
  },

  next() {
    advance(1);
  },

  prev() {
    const a = getAudio();
    if (a.currentTime > 4) {
      a.currentTime = 0;
      return;
    }
    advance(-1);
  },

  seek(seconds) {
    const a = getAudio();
    if (a.src) a.currentTime = seconds;
  },

  setShuffle(v) {
    const s = get();
    const current = s.queue[s.index];
    if (v && s.queue.length) {
      set({ shuffle: true, queue: shuffled(s.queue, current), index: 0 });
    } else {
      set({ shuffle: v });
    }
  },

  setRepeat(r) {
    set({ repeat: r });
  },

  snapshot() {
    const s = get();
    if (!s.queue.length) return null;
    return { queue: [...s.queue], index: s.index, position: audio?.currentTime ?? s.position, playlistId: s.playlistId };
  },

  restore(snap, fade = 0) {
    if (!snap.queue.length) return;
    set({ queue: snap.queue, playlistId: snap.playlistId });
    crossfadeTo(Math.min(snap.index, snap.queue.length - 1), fade, snap.position);
  },
}));

/** Lautstärke-Einstellung anwenden – sofort oder weich über `seconds` */
export function applyLocalVolume(seconds = 0) {
  // während einer Überblendung nicht dazwischenfunken
  if (!audio || ramps.has(audio)) return;
  if (audio.paused) audio.volume = targetVolume();
  else ramp(audio, targetVolume(), seconds);
}

// Regler, Angleichung oder frisch gemessener Titel → Lautstärke nachführen
useData.subscribe((d, prev) => {
  const m = d.data.settings.music;
  const pm = prev.data.settings.music;
  if (
    m.volume !== pm.volume ||
    m.normalize !== pm.normalize ||
    m.loudnessTarget !== pm.loudnessTarget ||
    m.spotifyOffsetDb !== pm.spotifyOffsetDb ||
    m.linkVolume !== pm.linkVolume
  ) {
    applyLocalVolume();
  } else if (d.data.tracks !== prev.data.tracks) {
    const t = currentLocalTrack();
    const before = t && prev.data.tracks.find((x) => x.id === t.id);
    if (t && before && t.loudness !== before.loudness) applyLocalVolume(1.5);
  }
});

/** Titel der Playlist (oder aller Titel), in Anzeigereihenfolge */
export function playlistTrackIds(playlistId: ID | null): ID[] {
  const { tracks, playlists } = useData.getState().data;
  if (!playlistId) return tracks.map((t) => t.id);
  const pl = playlists.find((p) => p.id === playlistId);
  const existing = new Set(tracks.map((t) => t.id));
  return pl ? pl.trackIds.filter((id) => existing.has(id)) : [];
}

export function currentLocalTrack(): LocalTrack | undefined {
  const s = useLocalPlayer.getState();
  const id = s.queue[s.index];
  return useData.getState().data.tracks.find((t) => t.id === id);
}

export function stopIfTrackRemoved(trackId: ID) {
  const s = useLocalPlayer.getState();
  if (s.queue[s.index] === trackId && audio) {
    audio.pause();
    audio.removeAttribute("src");
    useLocalPlayer.setState({ playing: false });
  }
  useLocalPlayer.setState((st) => {
    const current = st.queue[st.index];
    const queue = st.queue.filter((id) => id !== trackId);
    return { queue, index: Math.max(0, queue.indexOf(current)) };
  });
}
