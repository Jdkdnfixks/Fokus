import { describe, expect, it } from "vitest";
import { defaultSettings, normalizeData } from "../../store/defaults";
import {
  formatOffset,
  gainToSlider,
  localVolumeFor,
  sliderFromSpotifyPercent,
  sliderToGain,
  spotifyPercentFor,
  trackGain,
} from "./volume";

const music = (patch: Partial<ReturnType<typeof defaultSettings>["music"]> = {}) => ({ ...defaultSettings().music, ...patch });
const db = (gain: number) => 20 * Math.log10(gain);

describe("Lautstärkeregler", () => {
  it("arbeitet logarithmisch wie Spotify", () => {
    expect(sliderToGain(1)).toBe(1);
    expect(db(sliderToGain(0.75))).toBeCloseTo(-10);
    expect(db(sliderToGain(0.5))).toBeCloseTo(-20);
    expect(sliderToGain(0)).toBe(0);
    for (const v of [0.1, 0.42, 0.8, 1]) expect(gainToSlider(sliderToGain(v))).toBeCloseTo(v);
  });

  it("bringt jeden Titel auf den Pegel von Spotify (Normal = −14 LUFS)", () => {
    const m = music({ volume: 1, loudnessTarget: "normal" });
    expect(db(trackGain({ loudness: -8 }, m))).toBeCloseTo(-6);
    expect(db(trackGain({ loudness: -20 }, m))).toBeCloseTo(6);
    expect(trackGain({ loudness: undefined }, m)).toBe(1); // noch nicht gemessen
    expect(trackGain({ loudness: null }, m)).toBe(1); // nicht messbar
    expect(trackGain({ loudness: -8 }, { ...m, normalize: false })).toBe(1);
    expect(db(trackGain({ loudness: -8 }, { ...m, loudnessTarget: "quiet" }))).toBeCloseTo(-11);
  });

  it("zwei unterschiedlich laute Titel klingen danach gleich laut", () => {
    const m = music({ volume: 0.8 });
    const loud = -7;
    const quiet = -12;
    const outLoud = loud + db(localVolumeFor({ loudness: loud }, m));
    const outQuiet = quiet + db(localVolumeFor({ loudness: quiet }, m));
    expect(outLoud).toBeCloseTo(outQuiet);
  });

  it("verstärkt nie über 100 %", () => {
    expect(localVolumeFor({ loudness: -30 }, music({ volume: 1 }))).toBe(1);
  });

  it("Spotify folgt dem gemeinsamen Regler – der Feinabgleich macht die lautere Seite leiser", () => {
    const m = music({ volume: 0.6, linkVolume: true, spotifyOffsetDb: 0 });
    expect(spotifyPercentFor(m)).toBe(60);
    expect(spotifyPercentFor({ ...m, linkVolume: false })).toBeNull();

    // Spotify klingt zu laut → Spotify 4 dB leiser, eigene Musik unverändert
    const quieter = { ...m, spotifyOffsetDb: -4 };
    expect(spotifyPercentFor(quieter)).toBe(50);
    expect(localVolumeFor({ loudness: -14 }, quieter)).toBeCloseTo(localVolumeFor({ loudness: -14 }, m));

    // Spotify klingt zu leise → eigene Musik 4 dB leiser, Spotify unverändert
    const louder = { ...m, spotifyOffsetDb: 4 };
    expect(spotifyPercentFor(louder)).toBe(60);
    expect(db(localVolumeFor({ loudness: -14 }, louder)) - db(localVolumeFor({ loudness: -14 }, m))).toBeCloseTo(-4);

    // in Spotify geänderte Lautstärke lässt sich zurückrechnen
    expect(spotifyPercentFor({ ...quieter, volume: sliderFromSpotifyPercent(35, quieter) })).toBe(35);
    expect(formatOffset(-4)).toBe("−4 dB");
    expect(formatOffset(0)).toBe("±0 dB");
  });

  it("übernimmt die alte lineare Lautstärke beim Update", () => {
    const d = normalizeData({ settings: { music: { localVolume: 0.8 } } });
    expect(d.settings.music.volume).toBeCloseTo(gainToSlider(0.8));
    expect(sliderToGain(d.settings.music.volume)).toBeCloseTo(0.8);
    expect("localVolume" in d.settings.music).toBe(false);
    expect(d.settings.music.normalize).toBe(true);
    expect(d.settings.music.linkVolume).toBe(true);
  });
});
