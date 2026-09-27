import NoSleep from "nosleep.js";

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

if (typeof document !== "undefined") {
  // Browsers release the lock (and pause the video) when the page is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wanted && noSleep) {
      noSleep.disable();
      noSleep.enable().catch(() => undefined);
    }
  });
  // Any later tap re-arms the lock if it was lost (reload, background, failed start).
  document.addEventListener(
    "pointerdown",
    () => {
      if (wanted && !isWakeLockActive()) enableWakeLock();
    },
    { capture: true },
  );
}

export function wantWakeLock(): boolean {
  return wanted;
}
