import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});
mem.set("fokus-spotify-token", JSON.stringify({ access: "x", refresh: "y", expiresAt: Number.MAX_SAFE_INTEGER, clientId: "c" }));

/** Nachgebildeter Spotify-Server: ein PC-Gerät mit Lautstärke und Wiedergabe */
const server = {
  volume: 30,
  playing: false,
  deviceType: "Computer",
  volumeLog: [] as number[],
  playedAtVolume: [] as number[],
};

vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
  const u = new URL(url);
  const path = u.pathname.replace("/v1", "");
  const method = init.method ?? "GET";
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const none = () => new Response(null, { status: 204 });
  if (path === "/me/player/devices") {
    return json({ devices: [{ id: "pc", name: "PC", type: server.deviceType, is_active: true, volume_percent: server.volume }] });
  }
  if (path === "/me/player" && method === "GET") {
    return json({
      is_playing: server.playing,
      progress_ms: 1000,
      shuffle_state: false,
      context: { uri: "spotify:playlist:lern" },
      device: { id: "pc", name: "PC", volume_percent: server.volume },
      item: { name: "Titel", uri: "spotify:track:1", duration_ms: 200_000 },
    });
  }
  if (path === "/me/player/volume") {
    server.volume = Number(u.searchParams.get("volume_percent"));
    server.volumeLog.push(server.volume);
    return none();
  }
  if (path === "/me/player/play") {
    server.playing = true;
    server.playedAtVolume.push(server.volume);
    return none();
  }
  if (path === "/me/player/pause") {
    server.playing = false;
    return none();
  }
  return new Response(null, { status: 404 });
});

const { useData } = await import("../../store/data");
const sp = await import("./spotify");

function setMusic(patch: Partial<ReturnType<typeof useData.getState>["data"]["settings"]["music"]>) {
  useData.getState().setSettings((s) => ({ ...s, music: { ...s.music, ...patch } }));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  Object.assign(server, { volume: 30, playing: false, deviceType: "Computer", volumeLog: [], playedAtVolume: [] });
  setMusic({ volume: 0.6, linkVolume: true, spotifyOffsetDb: 0 });
  // Blenden aus früheren Tests auslaufen lassen, Zustand frisch laden
  await vi.advanceTimersByTimeAsync(10_000);
  await sp.refreshDevices();
  await sp.refreshPlayback();
  server.volumeLog = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Spotify folgt dem gemeinsamen Regler", () => {
  it("startet ohne Blende direkt mit der gemeinsamen Lautstärke", async () => {
    const p = sp.spotifyPlayFadeIn(null, 0);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(server.playedAtVolume).toEqual([60]); // schon vor dem Start eingestellt – kein lauter Moment
    expect(server.volume).toBe(60);
    expect(useData.getState().data.settings.music.volume).toBe(0.6);
  });

  it("blendet auf die gemeinsame Lautstärke ein", async () => {
    const p = sp.spotifyPlayFadeIn("spotify:playlist:lern", 2);
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(server.volumeLog[0]).toBe(0);
    expect(Math.max(...server.volumeLog)).toBe(60);
    expect(server.volume).toBe(60);
  });

  it("berücksichtigt den Feinabgleich", async () => {
    setMusic({ spotifyOffsetDb: -4 });
    const p = sp.spotifyPlayFadeIn(null, 0);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(server.volume).toBe(50);
  });

  it("übernimmt eine direkt in Spotify geänderte Lautstärke für die eigene Musik", async () => {
    const p = sp.spotifyPlayFadeIn(null, 0);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    await vi.advanceTimersByTimeAsync(6000);

    server.volume = 40; // in der Spotify-App leiser gestellt
    await sp.refreshPlayback();
    expect(useData.getState().data.settings.music.volume).toBeCloseTo(0.4);
  });

  it("ignoriert kurz nach eigenem Setzen veraltete Werte und fremde Geräte", async () => {
    const p = sp.spotifyPlayFadeIn(null, 0);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    server.volume = 20;
    await sp.refreshPlayback(); // < 5 s nach dem Setzen
    expect(useData.getState().data.settings.music.volume).toBe(0.6);

    await vi.advanceTimersByTimeAsync(6000);
    server.deviceType = "Smartphone";
    await sp.refreshDevices();
    await sp.refreshPlayback(); // Handy-Lautstärke gehört nicht zum PC
    expect(useData.getState().data.settings.music.volume).toBe(0.6);
  });

  it("überträgt den gemeinsamen Regler auf Spotify", async () => {
    server.playing = true;
    await sp.refreshPlayback();
    setMusic({ volume: 0.75 });
    sp.applyLinkedSpotifyVolume();
    await vi.advanceTimersByTimeAsync(500);
    expect(server.volume).toBe(75);
  });

  it("ohne Kopplung bleibt Spotify unberührt", async () => {
    setMusic({ linkVolume: false });
    const p = sp.spotifyPlayFadeIn(null, 0);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(server.volumeLog).toEqual([]);
    expect(server.volume).toBe(30);
  });
});
