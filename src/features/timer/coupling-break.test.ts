import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

// Spotify ohne Netzwerk: nur die Aufrufe mitschneiden
vi.mock("../music/spotify", async () => {
  const { create } = await vi.importActual<typeof import("zustand")>("zustand");
  const useSpotify = create<{ connected: boolean; playback: { isPlaying: boolean; contextUri: string | null } | null }>(() => ({
    connected: true,
    playback: null,
  }));
  return {
    useSpotify,
    isSpotifyConnected: () => true,
    spotifyPlay: vi.fn(async (uri?: string | null) => {
      useSpotify.setState({ playback: { isPlaying: true, contextUri: uri ?? useSpotify.getState().playback?.contextUri ?? null } });
    }),
    spotifyPause: vi.fn(async () => {
      const pb = useSpotify.getState().playback;
      useSpotify.setState({ playback: pb ? { ...pb, isPlaying: false } : null });
    }),
    spotifySnapshot: vi.fn(async () => ({ contextUri: "spotify:playlist:lern", trackUri: "spotify:track:x", positionMs: 90_000 })),
    spotifyRestore: vi.fn(async () => {}),
  };
});

const { useData } = await import("../../store/data");
const { useTimer } = await import("./timerStore");
const coupling = await import("./coupling");
const { useLocalPlayer } = await import("../music/localPlayer");
const spotify = await import("../music/spotify");

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(music: Partial<ReturnType<typeof useData.getState>["data"]["settings"]["music"]>) {
  useData.setState((s) => ({
    data: {
      ...s.data,
      tracks: [
        { id: "t1", file: "t1.mp3", title: "Lernmix", addedAt: "" },
        { id: "t2", file: "t2.mp3", title: "Pausenmix", addedAt: "" },
      ],
      playlists: [
        { id: "lern", name: "Lernen", trackIds: ["t1"] },
        { id: "pause", name: "Pause", trackIds: ["t2"] },
      ],
      settings: {
        ...s.data.settings,
        timer: { ...s.data.settings.timer, autoStartBreak: true, autoStartFocus: false },
        music: { ...s.data.settings.music, couple: true, sourceChosen: true, ...music },
      },
    },
  }));
  const player = {
    playQueue: vi.fn((ids: string[], _i?: number, playlistId?: string | null) =>
      useLocalPlayer.setState({ queue: ids, index: 0, playlistId: playlistId ?? null, playing: true }),
    ),
    pause: vi.fn(() => useLocalPlayer.setState({ playing: false })),
    resume: vi.fn(() => useLocalPlayer.setState({ playing: true })),
    snapshot: vi.fn(() => ({ queue: ["t1"], index: 0, position: 123, playlistId: "lern" })),
    restore: vi.fn(() => useLocalPlayer.setState({ queue: ["t1"], playlistId: "lern", playing: true })),
  };
  useLocalPlayer.setState({ queue: [], playing: false, playlistId: null, ...player });
  return player;
}

coupling.startCoupling();

beforeEach(() => {
  useTimer.getState().stop();
  coupling.resetCouplingState();
  vi.mocked(spotify.spotifyPlay).mockClear();
  vi.mocked(spotify.spotifyPause).mockClear();
  vi.mocked(spotify.spotifyRestore).mockClear();
  spotify.useSpotify.setState({ playback: null });
});

describe("Pausenmusik", () => {
  it("eigene Musik: wechselt in der Pause auf die Pausen-Playlist und setzt danach die Lernmusik fort", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "local", breakLocalPlaylistId: "pause" });

    useTimer.getState().start();
    await settle();
    expect(player.playQueue).toHaveBeenLastCalledWith(["t1"], 0, "lern");

    // Lernphase endet → Pause startet automatisch
    useTimer.getState().finishPhase(true);
    await settle();
    expect(player.snapshot).toHaveBeenCalled();
    expect(player.playQueue).toHaveBeenLastCalledWith(["t2"], 0, "pause");

    // Pause vorbei (übersprungen) → Timer wartet → Pausenmusik stoppt
    useTimer.getState().skip();
    await settle();
    expect(player.pause).toHaveBeenCalled();

    // nächste Lernphase → Lernmusik an der gemerkten Stelle
    useTimer.getState().start();
    await settle();
    expect(player.restore).toHaveBeenCalledWith(expect.objectContaining({ position: 123, playlistId: "lern" }), expect.any(Number));
    expect(player.playQueue).toHaveBeenCalledTimes(2);
  });

  it("Pause angehalten und fortgesetzt: Pausenmusik pausiert und läuft weiter", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "local", breakLocalPlaylistId: "pause" });
    useTimer.getState().start();
    useTimer.getState().finishPhase(true);
    await settle();
    useTimer.getState().pause();
    await settle();
    expect(player.pause).toHaveBeenCalledTimes(1);
    useTimer.getState().resume();
    await settle();
    expect(player.resume).toHaveBeenCalledTimes(1);
  });

  it("Spotify zum Lernen, eigene Musik in der Pause", async () => {
    const player = setup({ focusSource: "spotify", spotifyUri: "spotify:playlist:lern", breakSource: "local", breakLocalPlaylistId: "pause" });

    useTimer.getState().start();
    await settle();
    expect(spotify.spotifyPlay).toHaveBeenLastCalledWith("spotify:playlist:lern");

    useTimer.getState().finishPhase(true);
    await settle();
    expect(spotify.spotifyPause).toHaveBeenCalled();
    expect(player.playQueue).toHaveBeenLastCalledWith(["t2"], 0, "pause");

    useTimer.getState().skip();
    useTimer.getState().start();
    await settle();
    // gleiche Playlist war nur pausiert → fortsetzen statt neu starten
    expect(spotify.spotifyPlay).toHaveBeenLastCalledWith(null);
  });

  it("Spotify in beiden Phasen: Pausen-Playlist, danach zurück an die alte Stelle", async () => {
    setup({
      focusSource: "spotify",
      spotifyUri: "spotify:playlist:lern",
      breakSource: "spotify",
      breakSpotifyUri: "spotify:playlist:pause",
    });
    useTimer.getState().start();
    await settle();
    useTimer.getState().finishPhase(true);
    await settle();
    expect(spotify.spotifyPlay).toHaveBeenLastCalledWith("spotify:playlist:pause");

    useTimer.getState().skip();
    useTimer.getState().start();
    await settle();
    expect(spotify.spotifyRestore).toHaveBeenCalledWith(expect.objectContaining({ trackUri: "spotify:track:x", positionMs: 90_000 }));
  });

  it("„Weiterlaufen“ lässt die Lernmusik in der Pause an", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "continue" });
    useTimer.getState().start();
    await settle();
    useTimer.getState().finishPhase(true);
    await settle();
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.playQueue).toHaveBeenCalledTimes(1);
  });
});
