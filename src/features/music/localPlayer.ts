import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/tauri";
import { useData } from "../../store/data";
import type { ID, LocalTrack } from "../../store/types";

export type Repeat = "off" | "all" | "one";

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

  playQueue(trackIds: ID[], startIndex?: number, playlistId?: ID | null): void;
  toggle(): void;
  resume(fade?: number): void;
  pause(fade?: number): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  setShuffle(v: boolean): void;
  setRepeat(r: Repeat): void;
}

let audio: HTMLAudioElement | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let musicDir: string | null = null;

export function setMusicDir(dir: string | null) {
  musicDir = dir;
}

export function trackUrl(track: LocalTrack): string | null {
  if (!isTauri || !musicDir) return null;
  const sep = musicDir.includes("\\") ? "\\" : "/";
  return convertFileSrc(`${musicDir}${sep}${track.file}`);
}

function targetVolume() {
  return Math.max(0, Math.min(1, useData.getState().data.settings.music.localVolume));
}

function getAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("timeupdate", () => {
    useLocalPlayer.setState({ position: audio!.currentTime });
  });
  audio.addEventListener("loadedmetadata", () => {
    useLocalPlayer.setState({ duration: audio!.duration || 0 });
  });
  audio.addEventListener("ended", () => {
    const s = useLocalPlayer.getState();
    if (s.repeat === "one") {
      audio!.currentTime = 0;
      void audio!.play();
    } else {
      advance(1, true);
    }
  });
  audio.addEventListener("error", () => {
    useLocalPlayer.setState({ error: "Titel konnte nicht abgespielt werden.", playing: false });
  });
  return audio;
}

function clearFade() {
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

/** Blendet die Lautstärke weich über `seconds` auf `to`. */
function fadeTo(to: number, seconds: number, done?: () => void) {
  const a = getAudio();
  clearFade();
  if (seconds <= 0 || document.hidden) {
    a.volume = to;
    done?.();
    return;
  }
  const from = a.volume;
  const start = performance.now();
  fadeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
    a.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t >= 1) {
      clearFade();
      done?.();
    }
  }, 50);
}

function loadIndex(index: number, autoplay: boolean) {
  const s = useLocalPlayer.getState();
  const tracks = useData.getState().data.tracks;
  const id = s.queue[index];
  const track = tracks.find((t) => t.id === id);
  if (!track) return;
  const url = trackUrl(track);
  if (!url) {
    useLocalPlayer.setState({ error: "Musik lässt sich nur in der Desktop-App abspielen." });
    return;
  }
  const a = getAudio();
  a.src = url;
  a.volume = targetVolume();
  useLocalPlayer.setState({ index, position: 0, duration: track.duration ?? 0, error: null });
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

  playQueue(trackIds, startIndex = 0, playlistId = null) {
    if (!trackIds.length) return;
    const first = trackIds[startIndex];
    const queue = get().shuffle ? shuffled(trackIds, first) : trackIds;
    set({ queue, playlistId, index: 0 });
    loadIndex(get().shuffle ? 0 : startIndex, true);
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
}));

/** Lautstärke-Einstellung sofort anwenden */
export function applyLocalVolume() {
  if (audio && !fadeTimer) audio.volume = targetVolume();
}

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
