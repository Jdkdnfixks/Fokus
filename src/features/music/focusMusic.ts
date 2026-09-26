import { useData } from "../../store/data";
import type { ID, Settings } from "../../store/types";

type MusicSettings = Settings["music"];

function setMusic(patch: Partial<MusicSettings>) {
  useData.getState().setSettings((s) => ({ ...s, music: { ...s.music, ...patch } }));
}

/** Eigene Musik (eine Playlist oder alle Titel) als Lernmusik festlegen. */
export function chooseLocalFocusMusic(playlistId: ID | null) {
  setMusic({ focusSource: "local", localPlaylistId: playlistId, couple: true, sourceChosen: true });
}

/** Spotify-Playlist als Lernmusik festlegen. */
export function chooseSpotifyFocusMusic(uri: string | null, name?: string) {
  setMusic({ focusSource: "spotify", spotifyUri: uri, spotifyName: name, couple: true, sourceChosen: true });
}

export function chooseFocusSource(source: MusicSettings["focusSource"]) {
  setMusic({ focusSource: source, sourceChosen: true, ...(source !== "none" ? { couple: true } : {}) });
}

/**
 * Wurde noch keine Musikquelle gewählt, aber es gibt eigene Titel, spielt der
 * Timer ab jetzt automatisch die eigene Musik. Liefert true, wenn etwas
 * geändert wurde.
 */
export function ensureFocusMusicDefault(): boolean {
  const { settings, tracks } = useData.getState().data;
  const m = settings.music;
  if (m.sourceChosen || m.focusSource !== "none" || tracks.length === 0) return false;
  setMusic({ focusSource: "local", localPlaylistId: null, couple: true, sourceChosen: true });
  return true;
}
