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
/** Titel-Queue, die der Timer zuletzt gestartet hat (für "fortsetzen statt neu starten") */
let focusQueueKey: string | null = null;

export function startCoupling() {
  if (started) return;
  started = true;
  useTimer.subscribe((s, prev) => {
    const m = modeOf(s);
    const pm = modeOf(prev);
    if (m !== pm) void onModeChange(m);
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
  if (!music.couple) return;

  // ---- Hintergrundgeräusche ----
  const wantAmbient =
    (m === "focus-running" && music.ambientInFocus) || (m === "break-running" && music.ambientInBreak);
  const ambient = useAmbient.getState();
  if (wantAmbient && hasAmbientMix()) {
    if (!ambient.playing) ambientStart(true, 2);
  } else if (ambient.playing && ambient.byTimer) {
    ambientStop(music.fadeSeconds);
  }

  // ---- Musik ----
  if (music.focusSource === "none") return;
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

function startLocalFocusMusic(playlistId: string | null, fade: number) {
  const player = useLocalPlayer.getState();
  const key = playlistId ?? "__alle__";
  const ids = playlistTrackIds(playlistId);
  if (!ids.length) return;
  if (player.playing && focusQueueKey === key) return;
  if (focusQueueKey === key && player.queue.length) {
    player.resume(fade);
  } else {
    focusQueueKey = key;
    player.playQueue(ids, 0, playlistId);
  }
}

async function startSpotifyFocusMusic(uri: string | null) {
  const pb = useSpotify.getState().playback;
  if (pb?.isPlaying && (!uri || pb.contextUri === uri)) return;
  // gleiche Playlist pausiert → fortsetzen statt von vorne
  if (uri && pb && pb.contextUri === uri) await spotifyPlay(null);
  else await spotifyPlay(uri);
}
