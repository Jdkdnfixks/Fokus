import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Umgebung einer Desktop-App nachbilden: Tauri vorhanden, Dateipfade = URLs
vi.mock("../../lib/tauri", () => ({ isTauri: true, call: vi.fn(), callOr: vi.fn(), errorText: String }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}` }));

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

/** Minimales Audio-Element: Lautstärke, Abspielen, Position, Ereignisse */
class FakeAudio {
  static all: FakeAudio[] = [];
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = 7200;
  readyState = 0;
  preload = "";
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
    this.readyState = 0;
    // Metadaten kommen „etwas später“
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

const TARGET = 0.8;

/** das zuletzt gestartete, laufende Deck mit dieser Datei */
function deck(file: string) {
  return FakeAudio.all.filter((a) => a.src.includes(file) && !a.paused).at(-1)!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  setMusicDir("/musik");
  useData.setState((s) => ({
    data: {
      ...s.data,
      tracks: [
        { id: "t1", file: "lernen.mp3", title: "Lernmix", addedAt: "" },
        { id: "t2", file: "pause.mp3", title: "Pausenmix", addedAt: "" },
      ],
      settings: { ...s.data.settings, music: { ...s.data.settings.music, localVolume: TARGET } },
    },
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Überblendung im eigenen Player", () => {
  it("blendet über 3 Sekunden vom Lern- zum Pausentitel über", async () => {
    const p = useLocalPlayer.getState();
    p.playQueue(["t1"], 0, "lern");
    await vi.advanceTimersByTimeAsync(20);
    const lern = deck("lernen.mp3");
    expect(lern.paused).toBe(false);
    expect(lern.volume).toBeCloseTo(TARGET);

    useLocalPlayer.getState().playQueue(["t2"], 0, "pause", 3);
    await vi.advanceTimersByTimeAsync(20);
    const pause = deck("pause.mp3");
    expect(pause).not.toBe(lern);
    expect(pause.src).toContain("pause.mp3");
    expect(pause.paused).toBe(false);

    // Mitte der Überblendung: beide laufen, einer leiser, einer lauter
    await vi.advanceTimersByTimeAsync(1500);
    expect(lern.volume).toBeGreaterThan(0.2);
    expect(lern.volume).toBeLessThan(0.6);
    expect(pause.volume).toBeGreaterThan(0.2);
    expect(pause.volume).toBeLessThan(0.6);
    expect(lern.paused).toBe(false);

    // Ende: alter Titel stumm und angehalten, neuer auf voller Lautstärke
    await vi.advanceTimersByTimeAsync(1600);
    expect(lern.volume).toBe(0);
    expect(lern.paused).toBe(true);
    expect(pause.volume).toBeCloseTo(TARGET);
    expect(useLocalPlayer.getState().playlistId).toBe("pause");
  });

  it("setzt die Lernmusik nach der Pause an der gemerkten Stelle fort – ebenfalls mit Überblendung", async () => {
    useLocalPlayer.getState().playQueue(["t1"], 0, "lern");
    await vi.advanceTimersByTimeAsync(20);
    const lern = deck("lernen.mp3");
    lern.currentTime = 1234;
    const snap = useLocalPlayer.getState().snapshot()!;
    expect(snap.position).toBe(1234);

    useLocalPlayer.getState().playQueue(["t2"], 0, "pause", 3);
    await vi.advanceTimersByTimeAsync(3100);

    useLocalPlayer.getState().restore(snap, 3);
    await vi.advanceTimersByTimeAsync(20);
    const back = deck("lernen.mp3");
    expect(back.src).toContain("lernen.mp3");
    expect(back.currentTime).toBe(1234);
    expect(back.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(3100);
    expect(back.volume).toBeCloseTo(TARGET);
    expect(useLocalPlayer.getState().playlistId).toBe("lern");
  });

  it("Ereignisse des ausgeblendeten Titels stören den neuen nicht", async () => {
    useLocalPlayer.getState().playQueue(["t1"], 0, "lern");
    await vi.advanceTimersByTimeAsync(20);
    const lern = deck("lernen.mp3");
    useLocalPlayer.getState().playQueue(["t2"], 0, "pause", 3);
    await vi.advanceTimersByTimeAsync(20);
    lern.currentTime = 99;
    lern.emit("timeupdate");
    lern.emit("ended");
    expect(useLocalPlayer.getState().position).not.toBe(99);
    expect(useLocalPlayer.getState().queue).toEqual(["t2"]);
  });
});
