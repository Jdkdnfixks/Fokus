import { useData } from "../../store/data";
import { applyBlock, clearBlock } from "../blocker/blocker";
import { ambientStart, ambientStop, hasAmbientMix, useAmbient } from "../music/ambient";
import { playlistTrackIds, useLocalPlayer, type LocalSnapshot } from "../music/localPlayer";
import {
  isSpotifyConnected,
  spotifyFadeOutAndPause,
  spotifyPlayFadeIn,
  spotifyRestore,
  spotifySnapshot,
  spotifySwitch,
  useSpotify,
  type SpotifySnapshot,
} from "../music/spotify";
import { planNext, useTimer } from "./timerStore";

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
type AppSettings = ReturnType<typeof useData.getState>["data"]["settings"];
type MusicSettings = AppSettings["music"];

/** Was der Timer gerade abspielt */
let active: { role: "focus" | "break"; kind: Kind } | null = null;
/** Stand der Lernmusik, bevor die Pausenmusik übernommen hat */
let focusSnapshot: { kind: "local"; snap: LocalSnapshot } | { kind: "spotify"; snap: SpotifySnapshot } | null = null;
/** Überblendung, die schon kurz vor dem Phasenende begonnen hat */
let preTransition: "focus" | "break" | null = null;

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
  else if (kind === "spotify") await spotifyFadeOutAndPause(fade);
}

async function onMusic(m: Mode, music: MusicSettings) {
  const fade = music.fadeSeconds;
  const fKind = focusKind(music);

  switch (m) {
    case "focus-running": {
      // Überblendung lief schon in den letzten Sekunden der Pause
      if (preTransition === "focus") {
        preTransition = null;
        return;
      }
      preTransition = null;
      if (active?.role === "break") {
        const restored = await leaveBreak(active.kind, fKind, fade, music);
        active = fKind ? { role: "focus", kind: fKind } : null;
        if (restored) return;
      }
      await startFocusMusic(fKind, music, fade);
      return;
    }

    case "focus-paused":
    case "idle":
      preTransition = null;
      await pauseKind(active?.kind ?? fKind, fade);
      return;

    case "break-running": {
      // Überblendung lief schon in den letzten Sekunden der Lernphase
      if (preTransition === "break") {
        preTransition = null;
        return;
      }
      preTransition = null;
      if (music.breakSource === "continue") return;
      const bKind = breakKind(music);
      if (!bKind) {
        await pauseKind(active?.kind ?? fKind, fade);
        return;
      }
      if (active?.role === "break") {
        // Pause war angehalten und läuft weiter
        if (bKind === "local") useLocalPlayer.getState().resume(fade);
        else await spotifyPlayFadeIn(null, fade);
        return;
      }
      await enterBreak(bKind, fKind, music, fade);
      active = { role: "break", kind: bKind };
      return;
    }

    case "break-paused":
      preTransition = null;
      if (music.breakSource === "continue") return;
      await pauseKind(active?.kind ?? fKind, fade);
      return;
  }
}

/**
 * Wird kurz vor dem Ende einer laufenden Phase aufgerufen (so viele Sekunden
 * vorher, wie der Übergang dauert). Die alte Musik wird leiser, während die
 * Musik der nächsten Phase schon lauter wird – nahtlos wie bei Spotify.
 */
export async function onPhaseEnding() {
  const t = useTimer.getState();
  const { settings } = useData.getState().data;
  const music = settings.music;
  const fade = music.fadeSeconds;
  if (!music.couple || t.status !== "running" || fade <= 0) return;
  const fKind = focusKind(music);
  // Was kommt als Nächstes – startet es automatisch? (reguläres Phasenende angenommen)
  const step = planNext(t.phase, t.phase === "focus" ? t.cycle + 1 : t.cycle, settings.timer);

  if (t.phase === "focus") {
    const bKind = breakKind(music);
    if (step.next !== "focus" && step.autoStart) {
      if (music.breakSource === "continue") return;
      if (bKind) {
        preTransition = "break";
        await enterBreak(bKind, fKind, music, fade);
        active = { role: "break", kind: bKind };
        return;
      }
    }
    // keine Pausenmusik, Pause startet erst per Klick oder der Durchgang ist fertig:
    // Lernmusik zum Phasenende ausklingen lassen
    await pauseKind(active?.kind ?? fKind, fade);
    return;
  }

  // Pause endet
  if (step.autoStart) {
    preTransition = "focus";
    if (active?.role === "break") {
      const restored = await leaveBreak(active.kind, fKind, fade, music);
      active = fKind ? { role: "focus", kind: fKind } : null;
      if (!restored) await startFocusMusic(fKind, music, fade);
    } else if (music.breakSource !== "continue") {
      await startFocusMusic(fKind, music, fade);
    }
  } else {
    // Lernphase startet erst per Klick bzw. Durchgang ist fertig: Musik ausklingen lassen
    await pauseKind(active?.kind ?? (music.breakSource === "continue" ? fKind : null), fade);
  }
}

async function startFocusMusic(fKind: Kind | null, music: MusicSettings, fade: number) {
  if (fKind === "local") startLocalFocusMusic(music.localPlaylistId, fade);
  else if (fKind === "spotify") await startSpotifyFocusMusic(music.spotifyUri, fade);
  if (fKind) active = { role: "focus", kind: fKind };
}

/** Lernmusik merken und mit Überblendung zur Pausenmusik wechseln */
async function enterBreak(bKind: Kind, fKind: Kind | null, music: MusicSettings, fade: number) {
  const player = useLocalPlayer.getState();
  focusSnapshot = null;
  let spotifyOut: Promise<void> | null = null;

  if (fKind === "local") {
    const snap = player.snapshot();
    if (snap && bKind === "local") focusSnapshot = { kind: "local", snap }; // Überblendung ersetzt das Deck
    else player.pause(fade);
  } else if (fKind === "spotify") {
    if (bKind === "spotify") {
      const snap = await spotifySnapshot();
      if (snap) focusSnapshot = { kind: "spotify", snap };
    } else {
      spotifyOut = spotifyFadeOutAndPause(fade); // gleichzeitig zur einsetzenden Pausenmusik
    }
  }

  if (bKind === "local") {
    const ids = playlistTrackIds(music.breakLocalPlaylistId);
    useLocalPlayer.getState().playQueue(ids, 0, music.breakLocalPlaylistId, fade);
  } else if (fKind === "spotify") {
    await spotifySwitch(music.breakSpotifyUri, fade);
  } else {
    await spotifyPlayFadeIn(music.breakSpotifyUri, fade);
  }
  if (spotifyOut) await spotifyOut;
}

/**
 * Pausenmusik beenden. Nutzt die Lernmusik dieselbe Quelle, wird der gemerkte
 * Stand mit Überblendung wiederhergestellt (liefert dann true).
 */
async function leaveBreak(bKind: Kind, fKind: Kind | null, fade: number, music: MusicSettings): Promise<boolean> {
  const snap = focusSnapshot;
  focusSnapshot = null;
  if (snap && snap.kind === "local" && fKind === "local" && bKind === "local") {
    useLocalPlayer.getState().restore(snap.snap, fade);
    return true;
  }
  if (snap && snap.kind === "spotify" && fKind === "spotify" && bKind === "spotify") {
    await spotifyRestore(snap.snap, fade);
    return true;
  }
  if (bKind === "spotify" && fKind === "spotify") {
    // gleicher Spotify-Player: erst ausblenden, dann startet die Lernmusik
    await spotifyFadeOutAndPause(fade);
  } else if (bKind === "spotify") {
    void spotifyFadeOutAndPause(fade); // parallel zur einsetzenden Lernmusik
  } else if (fKind === "local") {
    // eigene Pausenmusik → eigene Lernmusik ohne gemerkten Stand: direkt überblenden
    const ids = playlistTrackIds(music.localPlaylistId);
    if (ids.length) {
      useLocalPlayer.getState().playQueue(ids, 0, music.localPlaylistId, fade);
      return true;
    }
    useLocalPlayer.getState().pause(fade);
  } else {
    useLocalPlayer.getState().pause(fade);
  }
  return false;
}

/** Nur für Tests: internen Zustand zurücksetzen */
export function resetCouplingState() {
  active = null;
  focusSnapshot = null;
  preTransition = null;
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
  if (ids.length) player.playQueue(ids, 0, playlistId, fade);
}

async function startSpotifyFocusMusic(uri: string | null, fade: number) {
  const pb = useSpotify.getState().playback;
  if (pb?.isPlaying && (!uri || pb.contextUri === uri)) return;
  // gleiche Playlist pausiert → fortsetzen statt von vorne
  if (uri && pb && pb.contextUri === uri) await spotifyPlayFadeIn(null, fade);
  else await spotifyPlayFadeIn(uri, fade);
}
