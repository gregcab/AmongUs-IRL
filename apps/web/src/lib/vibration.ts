// The Vibration API does not exist on iOS Safari: every vibration must be doubled by a visual cue.

export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function vibrate(pattern: number | readonly number[]): void {
  try {
    if (canVibrate()) navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
  } catch {
    // Some browsers throw without a prior user gesture.
  }
}

export const VIBRATION = {
  test: [120],
  killReady: [70, 80, 70],
  alarm: [900, 200, 900, 200, 900],
} as const;
