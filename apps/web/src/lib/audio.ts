// Sounds are synthesized with Web Audio: no asset to download, nothing to preload,
// and the context only needs one user gesture to unlock.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Must be called from a user gesture (click / touch). */
export function unlockAudio(): void {
  const c = context();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  // A silent buffer finishes unlocking on iOS Safari.
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, 22050);
  src.connect(c.destination);
  src.start(0);
}

export function isAudioUnlocked(): boolean {
  return ctx?.state === "running";
}

function tone(freq: number, start: number, duration: number, volume = 0.3, type: OscillatorType = "sine"): void {
  const c = context();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + start);
  gain.gain.setValueAtTime(0.0001, c.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(volume, c.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + duration + 0.05);
}

export function playReadyChime(): void {
  tone(660, 0, 0.15);
  tone(990, 0.15, 0.25);
}

/** Loud two-tone siren for meetings (~3 s). */
export function playAlarm(): void {
  const c = context();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  for (let i = 0; i < 6; i++) {
    tone(880, i * 0.5, 0.25, 0.6, "square");
    tone(587, i * 0.5 + 0.25, 0.25, 0.6, "square");
  }
}

export function playVictory(): void {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.18, 0.3, 0.4, "triangle"));
}
