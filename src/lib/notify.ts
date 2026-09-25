import { isTauri } from "./tauri";

let permission: boolean | null = null;

/** Windows-Benachrichtigung (in der App) bzw. Browser-Benachrichtigung (Vorschau). */
export async function notify(title: string, body: string) {
  try {
    if (isTauri) {
      const n = await import("@tauri-apps/plugin-notification");
      if (permission === null) permission = await n.isPermissionGranted();
      if (!permission) permission = (await n.requestPermission()) === "granted";
      if (permission) n.sendNotification({ title, body });
      return;
    }
    if ("Notification" in window) {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") new Notification(title, { body });
    }
  } catch {
    /* Benachrichtigungen sind optional */
  }
}
