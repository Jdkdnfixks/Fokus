import { isTauri } from "./tauri";

interface SavedBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
}

let saved: SavedBounds | null = null;

export const MINI_SIZE = { width: 300, height: 132 };

/** Verkleinert das Fenster auf einen kleinen Timer, der immer im Vordergrund bleibt. */
export async function enterMiniWindow() {
  if (!isTauri) return;
  const { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const size = (await win.innerSize()).toLogical(scale);
  const pos = (await win.outerPosition()).toLogical(scale);
  const maximized = await win.isMaximized();
  saved = { width: size.width, height: size.height, x: pos.x, y: pos.y, maximized };

  if (maximized) await win.unmaximize();
  await win.setDecorations(false);
  await win.setAlwaysOnTop(true);
  await win.setResizable(false);
  await win.setSize(new LogicalSize(MINI_SIZE.width, MINI_SIZE.height));

  // oben rechts auf dem aktuellen Bildschirm platzieren
  const monitor = await currentMonitor();
  if (monitor) {
    const mScale = monitor.scaleFactor;
    const mPos = monitor.position.toLogical(mScale);
    const mSize = monitor.size.toLogical(mScale);
    await win.setPosition(new LogicalPosition(mPos.x + mSize.width - MINI_SIZE.width - 24, mPos.y + 24));
  }
}

export async function exitMiniWindow() {
  if (!isTauri) return;
  const { getCurrentWindow, LogicalSize, LogicalPosition } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.setAlwaysOnTop(false);
  await win.setDecorations(true);
  await win.setResizable(true);
  if (saved) {
    await win.setSize(new LogicalSize(Math.max(saved.width, 900), Math.max(saved.height, 600)));
    await win.setPosition(new LogicalPosition(saved.x, saved.y));
    if (saved.maximized) await win.maximize();
  } else {
    await win.setSize(new LogicalSize(1280, 820));
    await win.center();
  }
  await win.setFocus();
}

export async function showMainWindow() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.show();
  await win.unminimize();
  await win.setFocus();
}
