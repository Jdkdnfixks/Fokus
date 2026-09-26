import { useData } from "../../store/data";
import { applyBlock, clearBlock } from "../blocker/blocker";
import { ambientStart, ambientStop, hasAmbientMix, useAmbient } from "../music/ambient";
import { playlistTrackIds, useLocalPlayer } from "../music/localPlayer";
import { isSpotifyConnected, spotifyPause, spotifyPlay, useSpotify } from "../music/spotify";
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
  if (!music.couple || music.focusSource === "none") return;
  const fade = music.fadeSeconds;

  if (m === "focus-running") {
    if (music.focusSource === "local") startLocalFocusMusic(music.localPlaylistId, fade);
    else if (music.focusSource === "spotify" && isSpotifyConnected()) await startSpotifyFocusMusic(music.spotifyUri);
    return;
  }

  const shouldPause = m === "focus-paused" || m === "idle" || (m.startsWith("break") && music.breakBehavior === "pause");
  if (!shouldPause) return;
  if (music.focusSource === "local") useLocalPlayer.getState().pause(fade);
  else if (music.focusSource === "spotify" && useSpotify.getState().playback?.isPlaying) await spotifyPause();
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
