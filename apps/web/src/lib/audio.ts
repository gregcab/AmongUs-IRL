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

/** Critical sabotage: fast rising "whoop" klaxon (~2.4 s). */
export function playSabotageAlarm(): void {
  const c = context();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  for (let i = 0; i < 4; i++) {
    const start = c.currentTime + i * 0.6;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(420, start);
    osc.frequency.exponentialRampToValueAtTime(1100, start + 0.45);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.45, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.55);
  }
}

/** Blackout: descending tones. */
export function playPowerDown(): void {
  [660, 440, 262].forEach((f, i) => tone(f, i * 0.22, 0.3, 0.35, "triangle"));
}

export function playRepaired(): void {
  [523, 784].forEach((f, i) => tone(f, i * 0.12, 0.2, 0.3, "sine"));
}

/** Short click for switches and pads. */
export function playClick(): void {
  tone(1200, 0, 0.05, 0.15, "square");
}

/** Short musical note (Simon pads, gauges). */
export function playNote(freq: number, duration = 0.25): void {
  tone(freq, 0, duration, 0.25, "triangle");
}

export function playError(): void {
  tone(160, 0, 0.3, 0.3, "square");
}

export function playSuccess(): void {
  [659, 880, 1175].forEach((f, i) => tone(f, i * 0.09, 0.18, 0.25, "sine"));
}

