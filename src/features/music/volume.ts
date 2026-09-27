import type { LocalTrack, Settings } from "../../store/types";

/**
 * Lautstärke-Rechnung für eigene Musik und Spotify.
 *
 * - Der Regler (0–1) arbeitet wie der von Spotify logarithmisch: 100 % = volle
 *   Lautstärke, jede 25 % weniger ≈ 10 dB leiser.
 * - Eigene Titel werden auf den Pegel gebracht, auf den Spotify normalisiert
 *   (Spotify-Einstellung „Lautstärkepegel“: Leise −19, Normal −14, Laut −11 LUFS).
 *   Laute Titel werden leiser, leise lauter – aber nur so weit, dass ihre
 *   Spitzen nicht übersteuern (höchstens −1 dBFS, wie bei Spotify).
 * - Der Feinabgleich macht immer die lautere Seite leiser.
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

type Measured = Pick<LocalTrack, "loudness" | "peak">;

/** Höchster Ausschlag nach dem Anheben (−1 dBFS) */
export const PEAK_CEILING = dbToGain(-1);

/** Faktor, der einen Titel auf den Zielpegel bringt (1, solange er nicht gemessen ist) */
export function trackGain(track: Measured | undefined, m: Music): number {
  if (!m.normalize || typeof track?.loudness !== "number") return 1;
  return dbToGain(LOUDNESS_TARGETS[m.loudnessTarget] - track.loudness);
}

/** Lautstärke des Players ohne Pegelausgleich (0–1): Regler und Feinabgleich */
export function faderTarget(m: Music): number {
  // Feinabgleich „Spotify lauter“ → eigene Musik entsprechend leiser
  const localQuieter = m.linkVolume ? Math.max(0, m.spotifyOffsetDb) : 0;
  return clamp01(sliderToGain(m.volume) * dbToGain(-localQuieter));
}

/**
 * Tatsächliche Verstärkung eines Titels bei gegebener Player-Lautstärke `fader`.
 * Kann über 1 liegen (leise Titel werden angehoben), aber nur bis die Spitzen
 * −1 dBFS erreichen. Ohne bekannte Spitze wird nicht angehoben.
 */
export function outputGain(fader: number, track: Measured | undefined, m: Music): number {
  const f = clamp01(fader);
  const g = trackGain(track, m);
  if (g <= 1) return f * g;
  const limit = typeof track?.peak === "number" && track.peak > 0 ? PEAK_CEILING / track.peak : 1;
  return Math.max(f, Math.min(f * g, limit));
}

/** Verstärkung eines Titels bei der eingestellten Lautstärke */
export function localVolumeFor(track: Measured | undefined, m: Music): number {
  return outputGain(faderTarget(m), track, m);
}

/** Korrektur eines Titels in dB bei der eingestellten Lautstärke (null = nicht gemessen) */
export function appliedCorrectionDb(track: Measured, m: Music): number | null {
  if (typeof track.loudness !== "number") return null;
  const f = faderTarget(m);
  if (!(f > 0)) return 0;
  return 20 * Math.log10(outputGain(f, track, m) / f);
}

/** true, wenn ein Titel bei dieser Lautstärke nicht ganz angehoben werden kann (Übersteuerungsschutz) */
export function isBoostLimited(track: Measured, m: Music): boolean {
  if (!m.normalize || typeof track.loudness !== "number") return false;
  const f = faderTarget(m);
  return f > 0 && trackGain(track, m) > 1 && outputGain(f, track, m) < f * trackGain(track, m) * 0.97;
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

/** z. B. „−4,8 dB“ */
export function formatDb(db: number): string {
  const r = Math.round(db * 10) / 10;
  if (r === 0) return "±0 dB";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dB`;
}
