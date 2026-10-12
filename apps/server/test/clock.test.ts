import { describe, expect, it } from "vitest";
import { GameClock } from "../src/clock";

describe("game clock", () => {
  const setup = () => {
    const t = { wall: 1_700_000_000_000, mono: 5_000.75 };
    const clock = new GameClock(() => t.wall, () => t.mono);
    const advance = (ms: number) => {
      t.wall += ms;
      t.mono += ms;
    };
    return { t, clock, advance };
  };

  it("starts on the wall clock and returns integer milliseconds", () => {
    const { clock, advance } = setup();
    expect(clock.now()).toBe(1_700_000_000_000);
    advance(1234.5);
    expect(clock.now()).toBe(1_700_000_001_234);
  });

  it("ignores a jump of the system clock", () => {
    const { t, clock, advance } = setup();
    advance(10_000);
    t.wall += 3_600_000; // NTP sets the clock one hour forward
    expect(clock.now()).toBe(1_700_000_010_000);
    expect(clock.drift()).toBe(3_600_000);
  });

  it("catches up only when idle and beyond the tolerance", () => {
    const { t, clock } = setup();
    t.wall += 1_500;
    expect(clock.resyncIfIdle(true)).toBe(0); // small drift kept
    t.wall -= 1_500 + 60_000;
    expect(clock.resyncIfIdle(false)).toBe(0); // a game is running
    expect(clock.now()).toBe(1_700_000_000_000);
    expect(clock.resyncIfIdle(true)).toBe(-60_000);
    expect(clock.now()).toBe(t.wall);
  });
});
