import { enterMiniWindow, exitMiniWindow } from "../../lib/window";
import { useTimer } from "./timerStore";

export async function setMiniMode(on: boolean) {
  if (useTimer.getState().mini === on) return;
  useTimer.getState().setMini(on);
  try {
    if (on) await enterMiniWindow();
    else await exitMiniWindow();
  } catch {
    /* Fenstersteuerung ist optional */
  }
}
