import { callOr } from "./tauri";

/** Eine Aktion für die Absturz-Erkennung festhalten (Fehler werden ignoriert). */
export function diag(text: string) {
  try {
    void Promise.resolve(callOr("diag_event", { text }, undefined)).catch(() => {});
  } catch {
    /* Diagnose darf nie stören */
  }
}
