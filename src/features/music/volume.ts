import type { LocalTrack, Settings } from "../../store/types";

/**
 * Lautstärke-Rechnung für eigene Musik und Spotify.
 *
 * - Der Regler (0–1) arbeitet wie der von Spotify logarithmisch: 100 % = volle
 *   Lautstärke, jede 25 % weniger ≈ 10 dB leiser.
 * - Eigene Titel werden auf den Pegel gebracht, auf den Spotify normalisiert
 *   (Spotify-Einstellung „Lautstärkepegel“: Leise −19, Normal −14, Laut −11 LUFS).
 * - Der Feinabgleich macht immer die lautere Seite leiser – so muss nie etwas
 *   über 100 % verstärkt werden.
 */

type Music = Settings["music"];

export const LOUDNESS_TARGETS = { quiet: -19, normal: -14, loud: -11 } as const;
export type LoudnessTarget = keyof typeof LOUDNESS_TARGETS;

/** Dynamikbereich des Reglers in dB */
export const VOLUME_RANGE_DB = 40;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const dbToGain = (db: number) => 10 ** (db / 20);

/** Reglerstellung → Verstärkungsfaktor */
export function sliderToGain(v: number): number {
  if (!(v > 0)) return 0;
  return dbToGain(VOLUME_RANGE_DB * (Math.min(1, v) - 1));
}

/** Verstärkungsfaktor → Reglerstellung (für die Übernahme alter Einstellungen) */
export function gainToSlider(gain: number): number {
  if (!(gain > 0)) return 0;
  return clamp01(1 + (20 * Math.log10(gain)) / VOLUME_RANGE_DB);
}

/** Faktor, der einen Titel auf den Zielpegel bringt (1, solange er nicht gemessen ist) */
export function trackGain(track: Pick<LocalTrack, "loudness"> | undefined, m: Music): number {
  if (!m.normalize || typeof track?.loudness !== "number") return 1;
  return dbToGain(LOUDNESS_TARGETS[m.loudnessTarget] - track.loudness);
}

/** Lautstärke (0–1) des Audio-Elements für einen eigenen Titel */
export function localVolumeFor(track: Pick<LocalTrack, "loudness"> | undefined, m: Music): number {
  // Feinabgleich „Spotify lauter“ → eigene Musik entsprechend leiser
  const localQuieter = m.linkVolume ? Math.max(0, m.spotifyOffsetDb) : 0;
  return clamp01(sliderToGain(m.volume) * trackGain(track, m) * dbToGain(-localQuieter));
}

/** Spotify-Lautstärke in Prozent, wenn Spotify dem gemeinsamen Regler folgt (sonst null) */
export function spotifyPercentFor(m: Music): number | null {
  if (!m.linkVolume) return null;
  if (!(m.volume > 0)) return 0;
  // Feinabgleich „Spotify leiser“ → Spotify-Regler entsprechend zurücknehmen
  const offset = Math.min(0, m.spotifyOffsetDb);
  return Math.round(100 * clamp01(m.volume + offset / VOLUME_RANGE_DB));
}

/** Umkehrung: in Spotify eingestellte Lautstärke → Stellung des gemeinsamen Reglers */
export function sliderFromSpotifyPercent(percent: number, m: Music): number {
  if (!(percent > 0)) return 0;
  const offset = Math.min(0, m.spotifyOffsetDb);
  return clamp01(percent / 100 - offset / VOLUME_RANGE_DB);
}

export function formatOffset(db: number): string {
  if (db === 0) return "±0 dB";
  return `${db > 0 ? "+" : "−"}${Math.abs(db)} dB`;
}
