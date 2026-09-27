import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TickCommand } from "../src/engine";
import { Scheduler } from "../src/scheduler";

describe("scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });
  afterEach(() => vi.useRealTimers());

  const phase = (key: string): TickCommand => ({ type: "tick:phaseEnd", key });

  it("fires due timers, replaces changed ones and cancels missing ones", () => {
    const fired: TickCommand[] = [];
    const s = new Scheduler((c) => fired.push(c));
    s.sync([
      { id: "phase", at: 2000, command: phase("a") },
      { id: "death:x", at: 3000, command: { type: "tick:deathEffective", playerId: "x", at: 3000 } },
    ]);
    s.sync([{ id: "phase", at: 5000, command: phase("b") }]);
    vi.advanceTimersByTime(3000);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([phase("b")]);
    expect(s.pending()).toEqual([]);
  });

  it("keeps an unchanged timer running and fires past deadlines immediately", () => {
    const fired: TickCommand[] = [];
    const s = new Scheduler((c) => fired.push(c));
    s.sync([{ id: "phase", at: 1500, command: phase("a") }]);
    vi.advanceTimersByTime(400);
    s.sync([{ id: "phase", at: 1500, command: phase("a") }]);
    vi.advanceTimersByTime(100);
    expect(fired).toEqual([phase("a")]);

    s.sync([{ id: "late", at: 0, command: phase("late") }]);
    vi.advanceTimersByTime(0);
    expect(fired.at(-1)).toEqual(phase("late"));
  });
});
