import { useEffect } from "react";
import { Maximize2, Pause, Play, SkipForward } from "lucide-react";
import { fmtClock } from "../../lib/time";
import { useNow } from "../../lib/useNow";
import { setMiniMode } from "./mini";
import { PHASE_COLOR } from "./TimerPage";
import { PHASE_LABEL, remainingNow, spaceToggleHandler, useTimer } from "./timerStore";

/** Kompakte Ansicht im Mini-Modus (Fenster klein und immer im Vordergrund) */
export function MiniTimer() {
  useEffect(() => {
    window.addEventListener("keydown", spaceToggleHandler);
    return () => window.removeEventListener("keydown", spaceToggleHandler);
  }, []);
  const t = useTimer();
  const now = useNow(250, t.status === "running");
  const remaining = remainingNow(t, now);
  const progress = t.durationMs ? 1 - remaining / t.durationMs : 0;
  const color = PHASE_COLOR[t.phase];

  return (
    <div className="mini" data-tauri-drag-region>
      <div className="mini-progress" style={{ width: `${progress * 100}%`, background: color }} />
      <div className="mini-body" data-tauri-drag-region>
        <div className="col" style={{ gap: 0 }} data-tauri-drag-region>
          <span className="mini-phase" style={{ color }} data-tauri-drag-region>
            {PHASE_LABEL[t.phase]}
            {t.status === "paused" ? " · pausiert" : ""}
          </span>
          <span className="mini-time tabular" data-tauri-drag-region>
            {fmtClock(remaining)}
          </span>
        </div>
        <div className="row gap-4">
          <button className="icon-btn" onClick={t.toggle} title={t.status === "running" ? "Pause" : "Start"}>
            {t.status === "running" ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="icon-btn" onClick={t.skip} title="Überspringen">
            <SkipForward size={17} />
          </button>
          <button className="icon-btn" onClick={() => void setMiniMode(false)} title="Großes Fenster">
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
