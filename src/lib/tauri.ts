import { invoke } from "@tauri-apps/api/core";

/** true, wenn die Oberfläche in der Desktop-App läuft (nicht im normalen Browser). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class NotInAppError extends Error {
  constructor() {
    super("Diese Funktion gibt es nur in der Desktop-App.");
  }
}

/** Ruft einen Befehl im Rust-Backend auf. */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new NotInAppError();
  return invoke<T>(cmd, args);
}

/** Wie `call`, liefert aber `fallback`, wenn die App im Browser läuft. */
export async function callOr<T>(cmd: string, args: Record<string, unknown> | undefined, fallback: T): Promise<T> {
  if (!isTauri) return fallback;
  return invoke<T>(cmd, args);
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await invoke("open_external", { url });
}

export async function onBackendEvent<T>(name: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(name, (e) => handler(e.payload));
}
