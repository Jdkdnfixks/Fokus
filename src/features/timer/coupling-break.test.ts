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
  const play = (uri: string | null) =>
    useSpotify.setState({ playback: { isPlaying: true, contextUri: uri ?? useSpotify.getState().playback?.contextUri ?? null } });
  return {
    useSpotify,
    isSpotifyConnected: () => true,
    spotifyPlayFadeIn: vi.fn(async (uri: string | null) => play(uri)),
    spotifySwitch: vi.fn(async (uri: string | null) => play(uri)),
    spotifyFadeOutAndPause: vi.fn(async () => {
      const pb = useSpotify.getState().playback;
      useSpotify.setState({ playback: pb ? { ...pb, isPlaying: false } : null });
    }),
    spotifySnapshot: vi.fn(async () => ({ contextUri: "spotify:playlist:lern", trackUri: "spotify:track:x", positionMs: 90_000 })),
    spotifyRestore: vi.fn(async () => play("spotify:playlist:lern")),
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
        timer: { ...s.data.settings.timer, autoContinue: true, longEvery: 3, longBreak: 30 },
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
  for (const fn of [spotify.spotifyPlayFadeIn, spotify.spotifySwitch, spotify.spotifyFadeOutAndPause, spotify.spotifyRestore]) {
    vi.mocked(fn).mockClear();
  }
  spotify.useSpotify.setState({ playback: null });
});

const FADE = 3;

describe("Pausenmusik", () => {
  it("eigene Musik: wechselt in der Pause auf die Pausen-Playlist und setzt danach die Lernmusik fort", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "local", breakLocalPlaylistId: "pause" });

    useTimer.getState().start();
    await settle();
    expect(player.playQueue).toHaveBeenLastCalledWith(["t1"], 0, "lern", FADE);

    // Lernphase endet → Pause startet automatisch
    useTimer.getState().finishPhase(true);
    await settle();
    expect(player.snapshot).toHaveBeenCalled();
    expect(player.playQueue).toHaveBeenLastCalledWith(["t2"], 0, "pause", FADE);

    // Pause vorbei → nächste Lernphase startet automatisch → Lernmusik an der gemerkten Stelle
    useTimer.getState().finishPhase(true);
    await settle();
    expect(useTimer.getState().phase).toBe("focus");
    expect(useTimer.getState().status).toBe("running");
    expect(player.restore).toHaveBeenCalledWith(expect.objectContaining({ position: 123, playlistId: "lern" }), FADE);
    expect(player.playQueue).toHaveBeenCalledTimes(2);
  });

  it("ohne automatischen Ablauf: Pause endet, Timer wartet, Pausenmusik stoppt", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "local", breakLocalPlaylistId: "pause" });
    useData.setState((s) => ({
      data: { ...s.data, settings: { ...s.data.settings, timer: { ...s.data.settings.timer, autoContinue: false } } },
    }));
    useTimer.getState().start();
    useTimer.getState().finishPhase(true);
    expect(useTimer.getState().status).toBe("idle");
    useTimer.getState().start(); // Pause per Klick
    await settle();
    expect(player.playQueue).toHaveBeenLastCalledWith(["t2"], 0, "pause", FADE);
    useTimer.getState().finishPhase(true);
    await settle();
    expect(useTimer.getState().status).toBe("idle");
    expect(player.pause).toHaveBeenCalled();
    useTimer.getState().start();
    await settle();
    expect(player.restore).toHaveBeenCalled();
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
    expect(spotify.spotifyPlayFadeIn).toHaveBeenLastCalledWith("spotify:playlist:lern", FADE);

    useTimer.getState().finishPhase(true);
    await settle();
    // Spotify wird leiser, während die eigene Pausenmusik einsetzt
    expect(spotify.spotifyFadeOutAndPause).toHaveBeenCalledWith(FADE);
    expect(player.playQueue).toHaveBeenLastCalledWith(["t2"], 0, "pause", FADE);

    useTimer.getState().finishPhase(true); // Pause vorbei → Lernphase startet automatisch
    await settle();
    // gleiche Playlist war nur pausiert → fortsetzen statt neu starten
    expect(spotify.spotifyPlayFadeIn).toHaveBeenLastCalledWith(null, FADE);
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
    expect(spotify.spotifySwitch).toHaveBeenLastCalledWith("spotify:playlist:pause", FADE);

    useTimer.getState().finishPhase(true);
    await settle();
    expect(spotify.spotifyRestore).toHaveBeenCalledWith(expect.objectContaining({ trackUri: "spotify:track:x", positionMs: 90_000 }), FADE);
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

describe("Überblendung vor dem Phasenende", () => {
  it("startet die Pausenmusik schon in den letzten Sekunden der Lernphase – und nicht noch einmal danach", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "local", breakLocalPlaylistId: "pause" });
    useTimer.getState().start();
    await settle();

    await coupling.onPhaseEnding(); // 3 s vor Ende
    expect(useTimer.getState().phase).toBe("focus");
    expect(player.playQueue).toHaveBeenLastCalledWith(["t2"], 0, "pause", FADE);

    useTimer.getState().finishPhase(true);
    await settle();
    expect(player.playQueue).toHaveBeenCalledTimes(2); // Lernmusik + Pausenmusik, kein zweiter Start
  });

  it("blendet die Musik nach der letzten Einheit zum Ende des Durchgangs aus", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "local", breakLocalPlaylistId: "pause" });
    useData.setState((s) => ({
      data: { ...s.data, settings: { ...s.data.settings, timer: { ...s.data.settings.timer, longEvery: 1, longBreak: 0 } } },
    }));
    useTimer.getState().start();
    await settle();
    await coupling.onPhaseEnding(); // letzte Einheit, keine lange Pause → keine Pausenmusik, nur ausblenden
    expect(player.pause).toHaveBeenCalledWith(FADE);
    expect(player.playQueue).toHaveBeenCalledTimes(1);
    useTimer.getState().finishPhase(true);
    await settle();
    expect(useTimer.getState().status).toBe("idle");
    expect(useTimer.getState().roundComplete).toBe(true);
  });

  it("blendet die Lernmusik vor einer stillen Pause schon vor dem Ende aus", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "pause" });
    useTimer.getState().start();
    await settle();
    await coupling.onPhaseEnding();
    expect(player.pause).toHaveBeenCalledWith(FADE);
  });

  it("überblendet am Ende der Pause zurück zur Lernmusik, wenn die Lernphase automatisch startet", async () => {
    const player = setup({ focusSource: "local", localPlaylistId: "lern", breakSource: "local", breakLocalPlaylistId: "pause" });
    useTimer.getState().start();
    await settle();
    useTimer.getState().finishPhase(true); // → Pause mit Pausenmusik
    await settle();

    await coupling.onPhaseEnding(); // 3 s vor Ende der Pause
    expect(player.restore).toHaveBeenCalledWith(expect.objectContaining({ position: 123 }), FADE);

    useTimer.getState().finishPhase(true); // → Lernphase startet automatisch
    await settle();
    expect(player.restore).toHaveBeenCalledTimes(1);
    expect(player.playQueue).toHaveBeenCalledTimes(2);
  });
});
