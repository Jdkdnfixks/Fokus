import { create } from "zustand";
import { audioContext } from "../../lib/audio";
import { useData } from "../../store/data";
import type { AmbientId } from "../../store/types";

/**
 * Hintergrundgeräusche werden per Web Audio erzeugt – ohne Audiodateien und
 * ohne Lizenzfragen. Jede Quelle ist eine Endlosschleife aus berechnetem
 * Rauschen, teils mit Filtern und langsamen Modulationen.
 */

export const AMBIENT_SOUNDS: { id: AmbientId; label: string; hint: string }[] = [
  { id: "rain", label: "Regen", hint: "gleichmäßiger Landregen" },
  { id: "stream", label: "Bach", hint: "plätscherndes Wasser" },
  { id: "waves", label: "Meer", hint: "langsame Wellen" },
  { id: "wind", label: "Wind", hint: "sanfte Böen" },
  { id: "fire", label: "Kaminfeuer", hint: "Knistern und Glut" },
  { id: "brown", label: "Braunes Rauschen", hint: "tief und warm" },
  { id: "pink", label: "Rosa Rauschen", hint: "ausgewogen" },
  { id: "white", label: "Weißes Rauschen", hint: "hell, maskiert Gespräche" },
];

interface AmbientState {
  playing: boolean;
  /** true, wenn der Timer die Geräusche gestartet hat */
  byTimer: boolean;
}

export const useAmbient = create<AmbientState>()(() => ({ playing: false, byTimer: false }));

interface Voice {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
}

let master: GainNode | null = null;
const voices = new Map<AmbientId, Voice>();
const buffers = new Map<string, AudioBuffer>();

function mix() {
  return useData.getState().data.settings.music.ambientMix;
}
function masterLevel() {
  return useData.getState().data.settings.music.ambientMaster;
}

/* ---------------- Rauschgeneratoren ---------------- */

type Fill = (data: Float32Array, sr: number, ch: number) => void;

function buffer(key: string, seconds: number, fill: Fill): AudioBuffer {
  const cached = buffers.get(key);
  if (cached) return cached;
  const ac = audioContext();
  const sr = ac.sampleRate;
  const fadeLen = Math.floor(sr * 0.5);
  const len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const tmp = new Float32Array(len + fadeLen);
    fill(tmp, sr, ch);
    // Ende weich in den Anfang überblenden → nahtlose Schleife
    for (let i = 0; i < fadeLen; i++) {
      const t = i / fadeLen;
      tmp[i] = tmp[i] * t + tmp[len + i] * (1 - t);
    }
    // normalisieren
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(tmp[i]));
    const norm = peak > 0 ? 0.9 / peak : 1;
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] = tmp[i] * norm;
  }
  buffers.set(key, buf);
  return buf;
}

const white: Fill = (d) => {
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
};

const pink: Fill = (d) => {
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
};

const brown: Fill = (d) => {
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last;
  }
};

/** Regen: rosa Rauschen plus viele kleine Tropfen */
const rain: Fill = (d, sr) => {
  pink(d, sr, 0);
  for (let i = 0; i < d.length; i++) d[i] *= 0.35;
  const drops = Math.floor((d.length / sr) * 70);
  for (let n = 0; n < drops; n++) {
    const pos = Math.floor(Math.random() * d.length);
    const amp = 0.2 + Math.random() * 0.8;
    const len = Math.floor(sr * (0.004 + Math.random() * 0.012));
    for (let i = 0; i < len && pos + i < d.length; i++) {
      d[pos + i] += (Math.random() * 2 - 1) * amp * Math.exp((-6 * i) / len);
    }
  }
};

/** Bach: gefiltertes Rauschen mit unruhiger, blubbernder Hüllkurve */
const stream: Fill = (d, sr) => {
  pink(d, sr, 0);
  let env = 0.5;
  let target = 0.5;
  const step = Math.floor(sr * 0.03);
  for (let i = 0; i < d.length; i++) {
    if (i % step === 0) target = 0.25 + Math.random() * 0.75;
    env += (target - env) * 0.002;
    d[i] *= env;
  }
};

/** Meer: braunes Rauschen mit langsamen Wellen (ca. 8 s) */
const waves: Fill = (d, sr, ch) => {
  brown(d, sr, ch);
  const period = 8 * sr;
  const offset = ch * sr * 0.4;
  for (let i = 0; i < d.length; i++) {
    const phase = ((i + offset) % period) / period;
    const swell = Math.pow(Math.sin(Math.PI * phase), 2.2);
    d[i] *= 0.15 + 0.85 * swell;
  }
};

/** Kaminfeuer: tiefe Glut plus unregelmäßiges Knistern */
const fire: Fill = (d, sr, ch) => {
  brown(d, sr, ch);
  for (let i = 0; i < d.length; i++) d[i] *= 0.6;
  const crackles = Math.floor((d.length / sr) * 9);
  for (let n = 0; n < crackles; n++) {
    const pos = Math.floor(Math.random() * d.length);
    const amp = 0.3 + Math.random() * 1.2;
    const len = Math.floor(sr * (0.001 + Math.random() * 0.004));
    for (let i = 0; i < len && pos + i < d.length; i++) {
      d[pos + i] += (Math.random() * 2 - 1) * amp * (1 - i / len);
    }
    // gelegentlich kleine Serien
    if (Math.random() < 0.3) {
      const burst = 2 + Math.floor(Math.random() * 4);
      for (let b = 1; b <= burst; b++) {
        const p = pos + Math.floor(sr * 0.02 * b * (0.5 + Math.random()));
        for (let i = 0; i < len && p + i < d.length; i++) {
          d[p + i] += (Math.random() * 2 - 1) * amp * 0.5 * (1 - i / len);
        }
      }
    }
  }
};

/* ---------------- Klangketten ---------------- */

function source(buf: AudioBuffer): AudioBufferSourceNode {
  const ac = audioContext();
  const s = ac.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  return s;
}

function filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = audioContext().createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function build(id: AmbientId, out: AudioNode): AudioScheduledSourceNode[] {
  const ac = audioContext();
  switch (id) {
    case "white": {
      const s = source(buffer("white", 6, white));
      const g = ac.createGain();
      g.gain.value = 0.35;
      s.connect(g).connect(out);
      return [s];
    }
    case "pink": {
      const s = source(buffer("pink", 8, pink));
      const g = ac.createGain();
      g.gain.value = 0.55;
      s.connect(g).connect(out);
      return [s];
    }
    case "brown": {
      const s = source(buffer("brown", 10, brown));
      s.connect(filter("lowpass", 900)).connect(out);
      return [s];
    }
    case "rain": {
      const s = source(buffer("rain", 12, rain));
      s.connect(filter("highpass", 500)).connect(filter("lowpass", 7000)).connect(out);
      return [s];
    }
    case "stream": {
      const s = source(buffer("stream", 10, stream));
      s.connect(filter("bandpass", 1400, 0.5)).connect(filter("highpass", 250)).connect(out);
      return [s];
    }
    case "waves": {
      const s = source(buffer("waves", 16, waves));
      s.connect(filter("lowpass", 1400)).connect(out);
      return [s];
    }
    case "wind": {
      const s = source(buffer("pink", 8, pink));
      const bp = filter("bandpass", 500, 1.4);
      const lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(bp.frequency);
      const amp = ac.createGain();
      amp.gain.value = 0.7;
      const ampLfo = ac.createOscillator();
      const ampLfoGain = ac.createGain();
      ampLfo.frequency.value = 0.045;
      ampLfoGain.gain.value = 0.3;
      ampLfo.connect(ampLfoGain).connect(amp.gain);
      s.connect(bp).connect(amp).connect(out);
      return [s, lfo, ampLfo];
    }
    case "fire": {
      const s = source(buffer("fire", 14, fire));
      s.connect(filter("lowpass", 3500)).connect(out);
      return [s];
    }
  }
}

function ensureMaster(): GainNode {
  const ac = audioContext();
  if (!master) {
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);
  }
  return master;
}

function startVoice(id: AmbientId, level: number) {
  if (voices.has(id)) return;
  const ac = audioContext();
  const gain = ac.createGain();
  gain.gain.value = 0;
  gain.connect(ensureMaster());
  const nodes = build(id, gain);
  nodes.forEach((n) => n.start());
  gain.gain.setTargetAtTime(level, ac.currentTime, 0.4);
  voices.set(id, { gain, nodes });
}

function stopVoice(id: AmbientId) {
  const v = voices.get(id);
  if (!v) return;
  const ac = audioContext();
  v.gain.gain.setTargetAtTime(0, ac.currentTime, 0.3);
  voices.delete(id);
  setTimeout(() => {
    v.nodes.forEach((n) => {
      try {
        n.stop();
      } catch {
        /* schon gestoppt */
      }
    });
    v.gain.disconnect();
  }, 1600);
}

/** Aktuelle Mischung anwenden (nach Änderungen an Reglern) */
export function syncAmbient() {
  if (!useAmbient.getState().playing) return;
  const ac = audioContext();
  const m = mix();
  for (const { id } of AMBIENT_SOUNDS) {
    const level = m[id] ?? 0;
    if (level > 0.001) {
      if (voices.has(id)) voices.get(id)!.gain.gain.setTargetAtTime(level, ac.currentTime, 0.15);
      else startVoice(id, level);
    } else {
      stopVoice(id);
    }
  }
  ensureMaster().gain.setTargetAtTime(masterLevel(), ac.currentTime, 0.15);
}

export function ambientStart(byTimer = false, fadeSeconds = 2) {
  const ac = audioContext();
  useAmbient.setState({ playing: true, byTimer });
  const m = ensureMaster();
  m.gain.cancelScheduledValues(ac.currentTime);
  m.gain.setValueAtTime(m.gain.value, ac.currentTime);
  m.gain.linearRampToValueAtTime(masterLevel(), ac.currentTime + Math.max(0.2, fadeSeconds));
  syncAmbient();
}

export function ambientStop(fadeSeconds = 2) {
  const ac = audioContext();
  useAmbient.setState({ playing: false, byTimer: false });
  if (!master) return;
  const g = master.gain;
  g.cancelScheduledValues(ac.currentTime);
  g.setValueAtTime(g.value, ac.currentTime);
  g.linearRampToValueAtTime(0, ac.currentTime + Math.max(0.2, fadeSeconds));
  const ids = [...voices.keys()];
  setTimeout(() => {
    if (!useAmbient.getState().playing) ids.forEach(stopVoice);
  }, (fadeSeconds + 0.3) * 1000);
}

export function ambientToggle() {
  if (useAmbient.getState().playing) ambientStop(1);
  else ambientStart(false, 1);
}

export function hasAmbientMix() {
  return Object.values(mix()).some((v) => (v ?? 0) > 0.001);
}
