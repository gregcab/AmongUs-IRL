import { performance } from "node:perf_hooks";

/** Wall clock jumps beyond this are caught up in the lobby. */
const MAX_DRIFT_MS = 2_000;

/**
 * Game time: wall-clock milliseconds anchored once, then advanced by the monotonic clock.
 * A Pi without a battery-backed RTC sets its clock by NTP whenever the network allows it:
 * with `Date.now`, such a jump in the middle of a game would expire (or stretch) every
 * deadline at once. Game time ignores it and only catches up in the lobby, where no
 * deadline is pending (`resyncIfIdle`). Deadlines sent to phones stay consistent because
 * `clock:sync` reports this same clock.
 */
export class GameClock {
  private base: number;

  constructor(
    private readonly wall: () => number = Date.now,
    private readonly mono: () => number = () => performance.now(),
  ) {
    this.base = wall() - mono();
  }

  /** Integer milliseconds: deadlines derived from it are compared by equality. */
  readonly now = (): number => Math.floor(this.base + this.mono());

  /** Wall clock minus game time. */
  drift(): number {
    return this.wall() - this.now();
  }

  /** Re-anchors on the wall clock when it moved away, if `idle` says no deadline is pending. */
  resyncIfIdle(idle: boolean): number {
    const drift = this.drift();
    if (!idle || Math.abs(drift) <= MAX_DRIFT_MS) return 0;
    this.base = this.wall() - this.mono();
    return drift;
  }
}
