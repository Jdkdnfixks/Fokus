import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { audioContext } from "../../lib/audio";
import { isTauri } from "../../lib/tauri";
import { useData } from "../../store/data";
import type { ID, LocalTrack } from "../../store/types";
import { faderTarget, outputGain } from "./volume";

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
 *
 * Jedes Deck läuft über Web Audio (Audio-Element → Verstärker → Ausgabe), damit
 * leise Titel auch über 100 % angehoben werden können. Klappt das nicht, regelt
 * Fokus wie früher direkt die Lautstärke des Audio-Elements.
 */
let audio: HTMLAudioElement | null = null;
const ramps = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();
/** Lautstärke eines Decks ohne Pegelausgleich (0–1), einschließlich Blenden */
const faders = new WeakMap<HTMLAudioElement, number>();
/** Web-Audio-Kette eines Decks */
const chains = new WeakMap<HTMLAudioElement, { source: MediaElementAudioSourceNode; gain: GainNode }>();
/** Titel, der in einem Deck geladen ist (für den Pegelausgleich) */
const deckTracks = new WeakMap<HTMLAudioElement, ID>();
/** Decks, die gerade spielen sollen (für den Wechsel auf ein einfaches Deck) */
const wantsPlay = new WeakSet<HTMLAudioElement>();
/** false, sobald sich gezeigt hat, dass Web Audio hier nicht funktioniert */
let webAudioOk = true;
let musicDir: string | null = null;

export function setMusicDir(dir: string | null) {
  musicDir = dir;
}

export function trackUrl(track: LocalTrack): string | null {
  if (!isTauri || !musicDir) return null;
  const sep = musicDir.includes("\\") ? "\\" : "/";
  return convertFileSrc(`${musicDir}${sep}${track.file}`);
}

const musicSettings = () => useData.getState().data.settings.music;

/** Player-Lautstärke laut Regler (der Pegelausgleich kommt je Titel dazu) */
function targetVolume() {
  return faderTarget(musicSettings());
}

function deckTrack(el: HTMLAudioElement): LocalTrack | undefined {
  const id = deckTracks.get(el);
  return id ? useData.getState().data.tracks.find((t) => t.id === id) : undefined;
}

/** Lautstärke eines Decks anwenden: Fader × Pegelausgleich des Titels. */
function applyDeck(el: HTMLAudioElement, smoothSeconds = 0) {
  const out = outputGain(faders.get(el) ?? 0, deckTrack(el), musicSettings());
  const chain = chains.get(el);
  if (chain) {
    el.volume = 1;
    const param = chain.gain.gain;
    param.setTargetAtTime(out, chain.gain.context.currentTime, smoothSeconds > 0 ? smoothSeconds / 3 : 0.01);
  } else {
    el.volume = Math.min(1, out);
  }
}

function getFader(el: HTMLAudioElement) {
  return faders.get(el) ?? 0;
}

function setFader(el: HTMLAudioElement, v: number) {
  faders.set(el, Math.max(0, Math.min(1, v)));
  applyDeck(el);
}

/** Hängt ein Deck an Web Audio. Muss vor dem ersten Laden passieren. */
function attachChain(el: HTMLAudioElement) {
  if (!isTauri || !webAudioOk || typeof AudioContext === "undefined") return;
  try {
    el.crossOrigin = "anonymous";
    const ac = audioContext();
    const source = ac.createMediaElementSource(el);
    const gain = ac.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ac.destination);
    chains.set(el, { source, gain });
  } catch {
    webAudioOk = false;
  }
}

function detachChain(el: HTMLAudioElement) {
  const chain = chains.get(el);
  if (!chain) return;
  try {
    chain.source.disconnect();
    chain.gain.disconnect();
  } catch {
    /* schon getrennt */
  }
  chains.delete(el);
}

/** Abspielen; läuft die Audio-Ausgabe nicht an, geht es ohne Web Audio weiter. */
async function playEl(el: HTMLAudioElement): Promise<void> {
  wantsPlay.add(el);
  if (chains.has(el)) {
    const ac = audioContext();
    if (ac.state !== "running") {
      await Promise.race([ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
    }
    if (ac.state !== "running" && el === audio) {
      switchToPlainDeck(el, true);
      return;
    }
  }
  await el.play();
}

function createAudio(plain = false): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  if (!plain) attachChain(el);
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
      void playEl(el).catch(() => {});
    } else {
      advance(1, true);
    }
  });
  el.addEventListener("error", () => {
    if (el !== audio || !el.getAttribute("src")) return;
    // Mit Web Audio nicht ladbar? Dann einmal ohne versuchen.
    if (chains.has(el)) {
      switchToPlainDeck(el, wantsPlay.has(el));
      return;
    }
    useLocalPlayer.setState({ error: "Titel konnte nicht abgespielt werden.", playing: false });
  });
  return el;
}

/**
 * Ersetzt ein Web-Audio-Deck durch ein einfaches Audio-Element (gleicher Titel,
 * gleiche Stelle). Klappt das, bleibt Fokus für diese Sitzung dabei.
 */
function switchToPlainDeck(failed: HTMLAudioElement, play: boolean) {
  const s = useLocalPlayer.getState();
  const position = failed.currentTime || 0;
  const fader = getFader(failed);
  stopRamp(failed);
  failed.pause();
  failed.removeAttribute("src");
  detachChain(failed);
  const el = createAudio(true);
  audio = el;
  el.addEventListener("loadedmetadata", () => (webAudioOk = false), { once: true });
  if (!loadInto(el, s.index)) return;
  setFader(el, fader || targetVolume());
  if (position > 0) el.currentTime = position;
  if (play) {
    wantsPlay.add(el);
    void el
      .play()
      .then(() => useLocalPlayer.setState({ playing: true }))
      .catch(() => useLocalPlayer.setState({ playing: false }));
  }
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
    setFader(el, to);
    done?.();
    return;
  }
  const from = getFader(el);
  const start = performance.now();
  ramps.set(
    el,
    setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
      setFader(el, from + (to - from) * t);
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
    detachChain(el);
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
  deckTracks.set(el, track.id);
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
  setFader(next, 0);
  const start = () => {
    if (position > 0) next.currentTime = Math.min(position, next.duration || position);
    void playEl(next)
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
  setFader(a, targetVolume());
  if (autoplay) {
    void playEl(a)
      .then(() => {
        if (audio === a) useLocalPlayer.setState({ playing: true });
      })
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
    setFader(a, fade > 0 ? 0 : targetVolume());
    void playEl(a)
      .then(() => {
        if (audio !== a) return;
        set({ playing: true });
        if (fade > 0) fadeTo(targetVolume(), fade);
      })
      .catch(() => set({ playing: false }));
  },

  pause(fade = 0) {
    const a = getAudio();
    if (!get().playing) return;
    set({ playing: false });
    wantsPlay.delete(a);
    fadeTo(0, fade, () => {
      a.pause();
      setFader(a, targetVolume());
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
  if (audio.paused) setFader(audio, targetVolume());
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
  } else if (d.data.tracks !== prev.data.tracks && audio) {
    // frisch gemessener Titel: Pegelausgleich weich nachführen
    const t = deckTrack(audio);
    const before = t && prev.data.tracks.find((x) => x.id === t.id);
    if (t && before && (t.loudness !== before.loudness || t.peak !== before.peak)) applyDeck(audio, 1.5);
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
