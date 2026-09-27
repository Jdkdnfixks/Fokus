import { useData } from "../../store/data";
import type { Settings } from "../../store/types";
import { applyLinkedSpotifyVolume } from "./spotify";

/** Gemeinsame Musiklautstärke setzen (eigene Musik folgt automatisch, Spotify bei Kopplung). */
export function setMusicVolume(volume: number) {
  const v = Math.max(0, Math.min(1, volume));
  useData.getState().setSettings((s) => ({ ...s, music: { ...s.music, volume: v } }));
  applyLinkedSpotifyVolume();
}

/** Eine Lautstärke-Einstellung ändern und Spotify ggf. nachziehen. */
export function setVolumeOption(patch: Partial<Settings["music"]>) {
  useData.getState().setSettings((s) => ({ ...s, music: { ...s.music, ...patch } }));
  applyLinkedSpotifyVolume(0);
}
