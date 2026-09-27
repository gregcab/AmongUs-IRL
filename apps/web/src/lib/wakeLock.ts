import NoSleep from "nosleep.js";
import { isAudioUnlocked, unlockAudio } from "./audio";

// Wake Lock needs a secure context (HTTPS/localhost). On plain LAN HTTP, NoSleep.js falls
// back to a muted looping video, which only starts from a user gesture.

let noSleep: NoSleep | null = null;
let wanted = false;

export function enableWakeLock(): void {
  wanted = true;
  noSleep ??= new NoSleep();
  if (noSleep.isEnabled) return;
  noSleep.enable().catch(() => {
    // Retried on the next gesture.
  });
}

export function isWakeLockActive(): boolean {
  return noSleep?.isEnabled ?? false;
}

/**
 * After a reload mid-game, sound and wake lock are lost until the next user gesture:
 * the next tap anywhere re-enables both.
 */
export function armDeviceFeatures(): void {
  wanted = true;
}

export function needsGesture(): boolean {
  return wanted && (!isAudioUnlocked() || !isWakeLockActive());
}

if (typeof document !== "undefined") {
  // Browsers release the lock (and pause the video) when the page is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wanted && noSleep) {
      noSleep.disable();
      noSleep.enable().catch(() => undefined);
    }
  });
  document.addEventListener(
    "pointerdown",
    () => {
      if (!wanted) return;
      if (!isAudioUnlocked()) unlockAudio();
      if (!isWakeLockActive()) enableWakeLock();
    },
    { capture: true },
  );
}
