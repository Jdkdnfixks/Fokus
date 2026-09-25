import type { ChimeSound } from "../store/types";
import { audioContext } from "./audio";

/**
 * Signaltöne werden synthetisch erzeugt – keine Audiodateien nötig.
 * "up" = Pause ist vorbei (aufsteigend), "down" = Lernphase ist vorbei.
 */
export function playChime(sound: ChimeSound, volume: number, direction: "up" | "down" = "down") {
  if (sound === "aus" || volume <= 0) return;
  const ac = audioContext();
  const out = ac.createGain();
  out.gain.value = Math.min(1, volume) * 0.5;
  out.connect(ac.destination);
  const t0 = ac.currentTime + 0.03;

  if (sound === "glocke") {
    const notes = direction === "down" ? [784, 523.25] : [523.25, 784];
    notes.forEach((f, i) => bell(ac, out, f, t0 + i * 0.55, 2.6));
  } else if (sound === "holz") {
    const notes = direction === "down" ? [880, 660, 660] : [660, 660, 880];
    notes.forEach((f, i) => wood(ac, out, f, t0 + i * 0.22));
  } else {
    const notes = direction === "down" ? [659.25, 523.25, 392] : [392, 523.25, 659.25];
    notes.forEach((f, i) => soft(ac, out, f, t0 + i * 0.28));
  }
  setTimeout(() => out.disconnect(), 5000);
}

function bell(ac: AudioContext, out: AudioNode, freq: number, t: number, decay: number) {
  const partials: [number, number][] = [
    [1, 1],
    [2.76, 0.35],
    [5.4, 0.12],
    [0.5, 0.2],
  ];
  for (const [ratio, amp] of partials) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * 0.4, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay / Math.sqrt(ratio));
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.1);
  }
}

function wood(ac: AudioContext, out: AudioNode, freq: number, t: number) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq * 1.6, t);
  osc.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq * 1.2;
  bp.Q.value = 2;
  osc.connect(bp).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.25);
}

function soft(ac: AudioContext, out: AudioNode, freq: number, t: number) {
  for (const [type, mult, amp] of [
    ["sine", 1, 0.35],
    ["triangle", 2, 0.06],
  ] as [OscillatorType, number, number][]) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq * mult;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.5);
  }
}
