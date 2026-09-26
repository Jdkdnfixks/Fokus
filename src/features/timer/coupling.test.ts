import { beforeAll, describe, expect, it, vi } from "vitest";

// Minimaler localStorage für die Node-Testumgebung
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

type Mods = {
  data: typeof import("../../store/data");
  timer: typeof import("./timerStore");
  coupling: typeof import("./coupling");
  player: typeof import("../music/localPlayer");
  focus: typeof import("../music/focusMusic");
};
let m: Mods;

beforeAll(async () => {
  m = {
    data: await import("../../store/data"),
    timer: await import("./timerStore"),
    coupling: await import("./coupling"),
    player: await import("../music/localPlayer"),
    focus: await import("../music/focusMusic"),
  };
});

describe("Musik startet mit dem Timer", () => {
  it("spielt die eigene MP3 in der Lernphase und setzt sie nach der Pause fort", () => {
    const { useData } = m.data;
    const { useTimer } = m.timer;
    const { useLocalPlayer } = m.player;

    // eine importierte MP3, Musikquelle noch nicht gewählt (Standard)
    useData.setState((s) => ({
      data: {
        ...s.data,
        tracks: [{ id: "t1", file: "t1.mp3", title: "Lange Lernmusik", addedAt: "" }],
      },
    }));
    expect(useData.getState().data.settings.music.focusSource).toBe("none");

    // Fokus wählt automatisch die eigene Musik
    expect(m.focus.ensureFocusMusicDefault()).toBe(true);
    expect(useData.getState().data.settings.music.focusSource).toBe("local");
    expect(m.focus.ensureFocusMusicDefault()).toBe(false);

    // Player-Aufrufe mitschneiden (kein echtes Audio im Test)
    const playQueue = vi.fn((ids: string[], _i?: number, playlistId?: string | null) =>
      useLocalPlayer.setState({ queue: ids, index: 0, playlistId: playlistId ?? null, playing: true }),
    );
    const pause = vi.fn(() => useLocalPlayer.setState({ playing: false }));
    const resume = vi.fn(() => useLocalPlayer.setState({ playing: true }));
    useLocalPlayer.setState({ playQueue, pause, resume });

    m.coupling.startCoupling();

    // Timer starten → MP3 startet
    useTimer.getState().start();
    expect(playQueue).toHaveBeenCalledTimes(1);
    expect(playQueue.mock.calls[0][0]).toEqual(["t1"]);

    // Timer pausieren → Musik pausiert
    useTimer.getState().pause();
    expect(pause).toHaveBeenCalledTimes(1);

    // weiter → an derselben Stelle fortsetzen, nicht neu starten
    useTimer.getState().resume();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(playQueue).toHaveBeenCalledTimes(1);

    // Lernphase endet → Pause startet automatisch → Musik pausiert
    useTimer.getState().finishPhase(true);
    expect(useTimer.getState().phase).not.toBe("focus");
    expect(pause).toHaveBeenCalledTimes(2);

    // nächste Lernphase → fortsetzen
    useTimer.getState().skip();
    useTimer.getState().start();
    expect(resume).toHaveBeenCalledTimes(2);
    expect(playQueue).toHaveBeenCalledTimes(1);
  });

  it("lässt bereits laufende Musik unangetastet", () => {
    const { useTimer } = m.timer;
    const { useLocalPlayer } = m.player;
    useTimer.getState().stop();
    const playQueue = vi.fn();
    const resume = vi.fn();
    useLocalPlayer.setState({ playing: true, playQueue, resume });
    useTimer.getState().start();
    expect(playQueue).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
