import { CloudRain, Droplets, Flame, Pause, Play, Waves, Wind, AudioLines } from "lucide-react";
import { Slider, Switch } from "../../components/ui";
import { useData, useSettings } from "../../store/data";
import type { AmbientId } from "../../store/types";
import { AMBIENT_SOUNDS, ambientStart, ambientStop, syncAmbient, useAmbient } from "./ambient";

const ICONS: Record<AmbientId, typeof Waves> = {
  rain: CloudRain,
  stream: Droplets,
  waves: Waves,
  wind: Wind,
  fire: Flame,
  brown: AudioLines,
  pink: AudioLines,
  white: AudioLines,
};

const PRESETS: { name: string; mix: Partial<Record<AmbientId, number>> }[] = [
  { name: "Regentag", mix: { rain: 0.6, fire: 0.25 } },
  { name: "Am Meer", mix: { waves: 0.65, wind: 0.2 } },
  { name: "Waldbach", mix: { stream: 0.5, wind: 0.25 } },
  { name: "Tiefe Konzentration", mix: { brown: 0.7 } },
  { name: "Gespräche ausblenden", mix: { pink: 0.5, rain: 0.3 } },
];

export function AmbientPanel() {
  const music = useSettings().music;
  const setSettings = useData((s) => s.setSettings);
  const playing = useAmbient((s) => s.playing);

  const setMix = (mix: Partial<Record<AmbientId, number>>) => {
    setSettings((s) => ({ ...s, music: { ...s.music, ambientMix: mix } }));
    setTimeout(syncAmbient, 0);
  };
  const setLevel = (id: AmbientId, v: number) => setMix({ ...music.ambientMix, [id]: v });
  const setMusic = (patch: Partial<typeof music>) => {
    setSettings((s) => ({ ...s, music: { ...s.music, ...patch } }));
    setTimeout(syncAmbient, 0);
  };

  return (
    <div className="col gap-16">
      <div className="card tight">
        <div className="row between wrap gap-12">
          <div className="row gap-12">
            <button className="play-circle" onClick={() => (playing ? ambientStop(1) : ambientStart(false, 1))} title={playing ? "Stopp" : "Abspielen"}>
              {playing ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
            </button>
            <div className="col" style={{ gap: 0 }}>
              <span className="strong">Hintergrundgeräusche</span>
              <span className="tiny faint">Mische mehrere Klänge. Alles wird direkt in der App erzeugt.</span>
            </div>
          </div>
          <div className="row gap-8" style={{ minWidth: 220 }}>
            <span className="tiny faint">Gesamt</span>
            <Slider value={music.ambientMaster} onChange={(v) => setMusic({ ambientMaster: v })} ariaLabel="Gesamtlautstärke" />
          </div>
        </div>
      </div>

      <div className="row wrap gap-4">
        <span className="small muted" style={{ marginRight: 4 }}>
          Vorschläge:
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className="chip"
            onClick={() => {
              setMix(p.mix);
              if (!playing) ambientStart(false, 1);
            }}
          >
            {p.name}
          </button>
        ))}
        <button className="chip" onClick={() => setMix({})}>
          Alle aus
        </button>
      </div>

      <div className="ambient-grid">
        {AMBIENT_SOUNDS.map((s) => {
          const Icon = ICONS[s.id];
          const level = music.ambientMix[s.id] ?? 0;
          return (
            <div key={s.id} className={`ambient-card ${level > 0 ? "on" : ""}`}>
              <div className="row between">
                <span className="ambient-icon">
                  <Icon size={18} />
                </span>
                <span className="tiny faint tabular">{level > 0 ? `${Math.round(level * 100)} %` : "aus"}</span>
              </div>
              <div className="col" style={{ gap: 0 }}>
                <span className="small strong">{s.label}</span>
                <span className="tiny faint">{s.hint}</span>
              </div>
              <Slider value={level} onChange={(v) => setLevel(s.id, v)} ariaLabel={s.label} />
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="setting">
          <div className="setting-text">
            <span>In Lernphasen automatisch abspielen</span>
            <span className="desc">Startet deine Mischung mit jeder Lernphase und blendet sie danach aus.</span>
          </div>
          <Switch checked={music.ambientInFocus} onChange={(v) => setMusic({ ambientInFocus: v, couple: v || music.couple })} />
        </div>
        <div className="setting">
          <div className="setting-text">
            <span>Auch in Pausen abspielen</span>
            <span className="desc">Zum Beispiel Meeresrauschen zum Entspannen.</span>
          </div>
          <Switch checked={music.ambientInBreak} onChange={(v) => setMusic({ ambientInBreak: v, couple: v || music.couple })} />
        </div>
      </div>
    </div>
  );
}
