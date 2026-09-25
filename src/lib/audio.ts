/** Gemeinsamer AudioContext für Signaltöne, Geräusche und die lokale Musik. */
let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: "playback" });
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
