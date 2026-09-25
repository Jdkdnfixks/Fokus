import { create } from "zustand";
import { call, errorText, isTauri } from "../../lib/tauri";
import { useData } from "../../store/data";

export interface BlockerStatus {
  hostsPath: string;
  writable: boolean;
  active: boolean;
  blocked: string[];
  supportedSetup: boolean;
}

interface BlockerState {
  status: BlockerStatus | null;
  busy: boolean;
  error: string | null;
}

export const useBlocker = create<BlockerState>()(() => ({ status: null, busy: false, error: null }));

export async function refreshBlockerStatus(): Promise<BlockerStatus | null> {
  if (!isTauri) {
    const s: BlockerStatus = { hostsPath: "–", writable: false, active: false, blocked: [], supportedSetup: false };
    useBlocker.setState({ status: s });
    return s;
  }
  try {
    const s = await call<BlockerStatus>("blocker_status");
    useBlocker.setState({ status: s });
    return s;
  } catch (e) {
    useBlocker.setState({ error: errorText(e) });
    return null;
  }
}

/** Sperrt die eingestellten Seiten (während der Lernphase). */
export async function applyBlock() {
  if (!isTauri) return;
  const domains = useData.getState().data.settings.blocker.domains;
  try {
    await call<string[]>("blocker_apply", { domains });
    useBlocker.setState({ error: null });
  } catch (e) {
    useBlocker.setState({ error: errorText(e) });
  }
  await refreshBlockerStatus();
}

export async function clearBlock() {
  if (!isTauri) return;
  try {
    await call("blocker_clear");
  } catch (e) {
    useBlocker.setState({ error: errorText(e) });
  }
  await refreshBlockerStatus();
}

/** Einmalige Einrichtung mit Windows-Abfrage (UAC). */
export async function setupBlocker(): Promise<boolean> {
  useBlocker.setState({ busy: true, error: null });
  try {
    const ok = await call<boolean>("blocker_setup");
    await refreshBlockerStatus();
    if (!ok) useBlocker.setState({ error: "Die Einrichtung hat nicht geklappt – die hosts-Datei ist weiterhin schreibgeschützt." });
    return ok;
  } catch (e) {
    useBlocker.setState({ error: errorText(e) });
    return false;
  } finally {
    useBlocker.setState({ busy: false });
  }
}

export async function teardownBlocker(): Promise<void> {
  useBlocker.setState({ busy: true, error: null });
  try {
    await call<boolean>("blocker_teardown");
  } catch (e) {
    useBlocker.setState({ error: errorText(e) });
  } finally {
    useBlocker.setState({ busy: false });
    await refreshBlockerStatus();
  }
}

/** Domain-Eingabe bereinigen (gleiche Regeln wie im Backend) */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.split(/[/?#:]/)[0].replace(/^\.+|\.+$/g, "");
  d = d.replace(/^www\./, "");
  if (!d || !d.includes(".") || d.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(d)) return null;
  if (d.split(".").some((l) => !l || l.startsWith("-") || l.endsWith("-"))) return null;
  return d;
}
