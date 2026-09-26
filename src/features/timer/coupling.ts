import { useData } from "../../store/data";
import { applyBlock, clearBlock } from "../blocker/blocker";
import { ambientStart, ambientStop, hasAmbientMix, useAmbient } from "../music/ambient";
import { playlistTrackIds, useLocalPlayer, type LocalSnapshot } from "../music/localPlayer";
import {
  isSpotifyConnected,
  spotifyPause,
  spotifyPlay,
  spotifyRestore,
  spotifySnapshot,
  useSpotify,
  type SpotifySnapshot,
} from "../music/spotify";
import { useTimer } from "./timerStore";

/**
 * Verknüpft den Timer mit Musik, Geräuschen und dem Website-Blocker:
 * Lernphase startet → Musik an, Seiten gesperrt; Pause → Musik aus, Seiten frei.
 */

type Mode = "idle" | "focus-running" | "focus-paused" | "break-running" | "break-paused";

function modeOf(s: { phase: string; status: string }): Mode {
  if (s.status === "idle") return "idle";
  const kind = s.phase === "focus" ? "focus" : "break";
  return `${kind}-${s.status === "running" ? "running" : "paused"}` as Mode;
}

let started = false;

export function startCoupling() {
  if (started) return;
  started = true;
  useTimer.subscribe((s, prev) => {
    const m = modeOf(s);
    const pm = modeOf(prev);
    if (m !== pm) void onModeChange(m);
  });
  // Blocker sofort an-/ausschalten, wenn er während einer Lernphase umgestellt wird
  useData.subscribe((d, prev) => {
    const b = d.data.settings.blocker;
    const pb = prev.data.settings.blocker;
    if (b === pb) return;
    const m = modeOf(useTimer.getState());
    const shouldBlock = b.enabled && (m.startsWith("focus") || (b.blockInBreaks && m.startsWith("break")));
    if (shouldBlock) void applyBlock();
    else if (pb.enabled) void clearBlock();
  });
}

async function onModeChange(m: Mode) {
  const settings = useData.getState().data.settings;

  // ---- Website-Blocker ----
  if (settings.blocker.enabled) {
    const block = m.startsWith("focus") || (settings.blocker.blockInBreaks && m.startsWith("break"));
    if (block) void applyBlock();
    else void clearBlock();
  }

  const music = settings.music;

  // ---- Hintergrundgeräusche (eigene Schalter, unabhängig von der Musik) ----
  const wantAmbient =
    (m === "focus-running" && music.ambientInFocus) || (m === "break-running" && music.ambientInBreak);
  const ambient = useAmbient.getState();
  if (wantAmbient && hasAmbientMix()) {
    if (!ambient.playing) ambientStart(true, 2);
  } else if (ambient.playing && ambient.byTimer) {
    ambientStop(music.fadeSeconds);
  }

  // ---- Musik ----
  if (!music.couple) return;
  await onMusic(m, music);
}

/* ================= Musik: Lern- und Pausenmusik ================= */

type Kind = "local" | "spotify";
type MusicSettings = ReturnType<typeof useData.getState>["data"]["settings"]["music"];

/** Was der Timer gerade abspielt */
let active: { role: "focus" | "break"; kind: Kind } | null = null;
/** Stand der Lernmusik, bevor die Pausenmusik übernommen hat */
let focusSnapshot: { kind: "local"; snap: LocalSnapshot } | { kind: "spotify"; snap: SpotifySnapshot } | null = null;

function focusKind(music: MusicSettings): Kind | null {
  if (music.focusSource === "local") return "local";
  if (music.focusSource === "spotify" && isSpotifyConnected()) return "spotify";
  return null;
}

function breakKind(music: MusicSettings): Kind | null {
  if (music.breakSource === "local") return playlistTrackIds(music.breakLocalPlaylistId).length ? "local" : null;
  if (music.breakSource === "spotify" && isSpotifyConnected() && music.breakSpotifyUri) return "spotify";
  return null;
}

async function pauseKind(kind: Kind | null, fade: number) {
  if (kind === "local") useLocalPlayer.getState().pause(fade);
  else if (kind === "spotify" && useSpotify.getState().playback?.isPlaying) await spotifyPause();
}

async function onMusic(m: Mode, music: MusicSettings) {
  const fade = music.fadeSeconds;
  const fKind = focusKind(music);

  switch (m) {
    case "focus-running": {
      // Kommt die Lernphase nach Pausenmusik, zuerst zurückschalten
      if (active?.role === "break") {
        const restored = await leaveBreak(active.kind, fKind, fade);
        active = fKind ? { role: "focus", kind: fKind } : null;
        if (restored) return;
      }
      if (fKind === "local") startLocalFocusMusic(music.localPlaylistId, fade);
      else if (fKind === "spotify") await startSpotifyFocusMusic(music.spotifyUri);
      if (fKind) active = { role: "focus", kind: fKind };
      return;
    }

    case "focus-paused":
    case "idle":
      await pauseKind(active?.kind ?? fKind, fade);
      return;

    case "break-running": {
      if (music.breakSource === "continue") return;
      const bKind = breakKind(music);
      if (!bKind) {
        await pauseKind(fKind, fade);
        return;
      }
      if (active?.role === "break") {
        // Pause war angehalten und läuft weiter
        if (bKind === "local") useLocalPlayer.getState().resume(fade);
        else await spotifyPlay(null);
        return;
      }
      await enterBreak(bKind, fKind, music, fade);
      active = { role: "break", kind: bKind };
      return;
    }

    case "break-paused":
      if (music.breakSource === "continue") return;
      if (active?.role === "break") await pauseKind(active.kind, fade);
      else await pauseKind(fKind, fade);
      return;
  }
}

/** Lernmusik merken und Pausenmusik starten */
async function enterBreak(bKind: Kind, fKind: Kind | null, music: MusicSettings, fade: number) {
  const player = useLocalPlayer.getState();
  focusSnapshot = null;
  if (fKind === "local") {
    const snap = player.snapshot();
    if (snap && bKind === "local") focusSnapshot = { kind: "local", snap };
    else player.pause(fade);
  } else if (fKind === "spotify") {
    if (bKind === "spotify") {
      const snap = await spotifySnapshot();
      if (snap) focusSnapshot = { kind: "spotify", snap };
    } else await pauseKind("spotify", fade);
  }

  if (bKind === "local") {
    const ids = playlistTrackIds(music.breakLocalPlaylistId);
    useLocalPlayer.getState().playQueue(ids, 0, music.breakLocalPlaylistId);
  } else {
    await spotifyPlay(music.breakSpotifyUri);
  }
}

/**
 * Pausenmusik beenden. Nutzt die Lernmusik dieselbe Quelle, wird der gemerkte
 * Stand wiederhergestellt (liefert dann true).
 */
async function leaveBreak(bKind: Kind, fKind: Kind | null, fade: number): Promise<boolean> {
  const snap = focusSnapshot;
  focusSnapshot = null;
  if (snap && snap.kind === "local" && fKind === "local" && bKind === "local") {
    useLocalPlayer.getState().restore(snap.snap, fade);
    return true;
  }
  if (snap && snap.kind === "spotify" && fKind === "spotify" && bKind === "spotify") {
    await spotifyRestore(snap.snap);
    return true;
  }
  await pauseKind(bKind, fade);
  return false;
}

/** Nur für Tests: internen Zustand zurücksetzen */
export function resetCouplingState() {
  active = null;
  focusSnapshot = null;
}

/**
 * Startet die eigene Lernmusik. Läuft schon etwas, bleibt es unverändert.
 * Ist die gewählte Playlist nur pausiert, geht es an derselben Stelle weiter
 * (wichtig bei langen MP3s) – sonst beginnt die Playlist von vorne.
 */
function startLocalFocusMusic(playlistId: string | null, fade: number) {
  const player = useLocalPlayer.getState();
  if (player.playing) return;
  if (player.queue.length && player.playlistId === playlistId) {
    player.resume(fade);
    return;
  }
  const ids = playlistTrackIds(playlistId);
  if (ids.length) player.playQueue(ids, 0, playlistId);
}

async function startSpotifyFocusMusic(uri: string | null) {
  const pb = useSpotify.getState().playback;
  if (pb?.isPlaying && (!uri || pb.contextUri === uri)) return;
  // gleiche Playlist pausiert → fortsetzen statt von vorne
  if (uri && pb && pb.contextUri === uri) await spotifyPlay(null);
  else await spotifyPlay(uri);
}
