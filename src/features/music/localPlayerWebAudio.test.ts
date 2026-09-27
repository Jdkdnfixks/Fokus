import { beforeEach, describe, expect, it, vi } from "vitest";

// Desktop-App mit funktionierendem Web Audio nachbilden
vi.mock("../../lib/tauri", () => ({ isTauri: true, call: vi.fn(), callOr: vi.fn(), errorText: String }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}` }));

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

/** Verstärker: übernimmt Zielwerte sofort */
class FakeGain {
  gain = {
    value: 1,
    setTargetAtTime: (v: number) => {
      this.gain.value = v;
    },
  };
  context = { currentTime: 0 };
  connected = true;
  connect() {}
  disconnect() {
    this.connected = false;
  }
}
const gains = new Map<object, FakeGain>();
const ctx = {
  state: "running",
  currentTime: 0,
  destination: {},
  resume: async () => {},
  createMediaElementSource: (el: object) => {
    const g = new FakeGain();
    gains.set(el, g);
    return { connect: () => {}, disconnect: () => {} };
  },
  createGain: () => [...gains.values()].at(-1)!,
};
vi.mock("../../lib/audio", () => ({ audioContext: () => ctx }));
vi.stubGlobal("AudioContext", class {});

class FakeAudio {
  static all: FakeAudio[] = [];
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = 7200;
  readyState = 0;
  preload = "";
  crossOrigin: string | null = null;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Set<() => void>>();
  constructor() {
    FakeAudio.all.push(this);
  }
  get src() {
    return this.attrs.get("src") ?? "";
  }
  set src(v: string) {
    this.attrs.set("src", v);
    setTimeout(() => {
      this.readyState = 1;
      this.emit("loadedmetadata");
    }, 10);
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  removeAttribute(n: string) {
    this.attrs.delete(n);
  }
  load() {}
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener(t: string, fn: () => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: () => void) {
    this.listeners.get(t)?.delete(fn);
  }
  emit(t: string) {
    for (const fn of [...(this.listeners.get(t) ?? [])]) fn();
  }
}
vi.stubGlobal("Audio", FakeAudio);

const { useData } = await import("../../store/data");
const { useLocalPlayer, setMusicDir } = await import("./localPlayer");
const { gainToSlider, PEAK_CEILING } = await import("./volume");

const FADER = 10 ** (-10 / 20); // Regler auf −10 dB
const db = (g: number) => 20 * Math.log10(g);

function playing(file: string) {
  return FakeAudio.all.filter((a) => a.src.includes(file) && !a.paused).at(-1)!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  setMusicDir("/musik");
  useData.setState((s) => ({
    data: {
      ...s.data,
      tracks: [
        { id: "laut", file: "laut.mp3", title: "Laut", addedAt: "", loudness: -8, peak: 1 },
        { id: "leise", file: "leise.mp3", title: "Leise", addedAt: "", loudness: -20, peak: 0.3 },
        { id: "spitz", file: "spitz.mp3", title: "Leise mit Spitzen", addedAt: "", loudness: -20, peak: 0.95 },
      ],
      settings: {
        ...s.data.settings,
        music: { ...s.data.settings.music, volume: gainToSlider(FADER), normalize: true, loudnessTarget: "normal", linkVolume: true, spotifyOffsetDb: 0 },
      },
    },
  }));
});

describe("Pegelausgleich über Web Audio", () => {
  it("läuft über den Verstärker, das Audio-Element bleibt auf 100 %", async () => {
    useLocalPlayer.getState().playQueue(["laut"], 0, null);
    await vi.advanceTimersByTimeAsync(20);
    const el = playing("laut.mp3");
    expect(el.crossOrigin).toBe("anonymous");
    expect(el.volume).toBe(1);
    expect(db(gains.get(el)!.gain.value)).toBeCloseTo(-10 - 6);
  });

  it("hebt leise Titel über 100 % an – laut und leise klingen gleich", async () => {
    useLocalPlayer.getState().playQueue(["leise"], 0, null);
    await vi.advanceTimersByTimeAsync(20);
    const g = gains.get(playing("leise.mp3"))!.gain.value;
    expect(db(g)).toBeCloseTo(-10 + 6); // −20 LUFS → +6 dB
    // gleiche Ausgangslautheit wie der laute Titel: −8 − 16 = −20 + (−4) = −24 LUFS
    expect(-20 + db(g)).toBeCloseTo(-8 + (-10 - 6));
  });

  it("schützt vor Übersteuern: angehoben wird nur bis −1 dBFS", async () => {
    const fader = 10 ** (-3 / 20); // Regler weit oben: wenig Luft nach oben
    useData.getState().setSettings((s) => ({ ...s, music: { ...s.music, volume: gainToSlider(fader) } }));
    useLocalPlayer.getState().playQueue(["spitz"], 0, null);
    await vi.advanceTimersByTimeAsync(20);
    const g = gains.get(playing("spitz.mp3"))!.gain.value;
    expect(g * 0.95).toBeCloseTo(PEAK_CEILING); // Spitze landet genau bei −1 dBFS
    expect(g).toBeGreaterThan(fader); // aber immer noch lauter als ohne Ausgleich
  });

  it("Überblendung und Regler wirken auf den Verstärker", async () => {
    useLocalPlayer.getState().playQueue(["laut"], 0, null);
    await vi.advanceTimersByTimeAsync(20);
    const a = playing("laut.mp3");
    useLocalPlayer.getState().playQueue(["leise"], 0, null, 2);
    await vi.advanceTimersByTimeAsync(1000);
    const b = playing("leise.mp3");
    expect(gains.get(a)!.gain.value).toBeGreaterThan(0);
    expect(gains.get(b)!.gain.value).toBeLessThan(10 ** ((-10 + 6) / 20));
    await vi.advanceTimersByTimeAsync(1100);
    expect(gains.get(a)!.gain.value).toBe(0);
    expect(gains.get(a)!.connected).toBe(false); // altes Deck freigegeben
    expect(db(gains.get(b)!.gain.value)).toBeCloseTo(-4);

    useData.getState().setSettings((s) => ({ ...s, music: { ...s.music, volume: 1 } }));
    expect(db(gains.get(b)!.gain.value)).toBeCloseTo(6); // Spitze 0,3 → genug Luft für +6 dB
  });

  it("fällt auf das einfache Audio-Element zurück, wenn Web Audio nicht laden kann", async () => {
    useLocalPlayer.getState().playQueue(["laut"], 0, null);
    await vi.advanceTimersByTimeAsync(20);
    const el = playing("laut.mp3");
    el.emit("error");
    await vi.advanceTimersByTimeAsync(20);
    const plain = playing("laut.mp3");
    expect(plain).not.toBe(el);
    expect(plain.crossOrigin).toBeNull();
    expect(plain.volume).toBeCloseTo(FADER * 10 ** (-6 / 20));
    expect(useLocalPlayer.getState().error).toBeNull();
  });
});
