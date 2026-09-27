import { create } from "zustand";
import { call, isTauri } from "../../lib/tauri";
import { useData } from "../../store/data";
import type { ID } from "../../store/types";

/**
 * Misst im Hintergrund die Lautheit aller noch nicht gemessenen Titel –
 * einer nach dem anderen, damit der PC nicht ausgebremst wird.
 */

export const useLoudnessScan = create<{ currentId: ID | null }>(() => ({ currentId: null }));

let started = false;
let running = false;
/** in dieser Sitzung fehlgeschlagen (z. B. Datei noch nicht aus der Cloud geladen) */
const failed = new Set<ID>();

function nextTrack() {
  return useData.getState().data.tracks.find((t) => t.loudness === undefined && !failed.has(t.id));
}

async function run() {
  if (running || !isTauri) return;
  running = true;
  try {
    for (let t = nextTrack(); t; t = nextTrack()) {
      useLoudnessScan.setState({ currentId: t.id });
      try {
        const lufs = await call<number | null>("music_loudness", { file: t.file });
        const store = useData.getState();
        if (store.data.tracks.some((x) => x.id === t!.id)) store.patch("tracks", t.id, { loudness: lufs ?? null });
      } catch {
        failed.add(t.id);
      }
    }
  } finally {
    running = false;
    useLoudnessScan.setState({ currentId: null });
  }
}

export function startLoudnessScan() {
  if (started) return;
  started = true;
  // kurz warten, damit der Start der App nicht gebremst wird
  setTimeout(() => void run(), 4000);
  useData.subscribe((d, prev) => {
    if (d.data.tracks !== prev.data.tracks && nextTrack()) void run();
  });
}

/** erneut versuchen (z. B. nachdem die Dateien aus der Cloud geladen wurden) */
export function retryLoudnessScan() {
  failed.clear();
  void run();
}
