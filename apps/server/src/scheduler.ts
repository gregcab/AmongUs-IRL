import type { TickCommand, TimerRequest } from "./engine";

interface Scheduled {
  at: number;
  key: string;
  handle: ReturnType<typeof setTimeout>;
}

/**
 * Holds exactly the timers requested by the latest engine result: timers with a new
 * deadline are rescheduled, missing ones are cancelled. Fired timers become tick commands.
 */
export class Scheduler {
  private readonly timers = new Map<string, Scheduled>();

  constructor(
    private readonly onTick: (command: TickCommand) => void,
    private readonly clock: () => number = Date.now,
  ) {}

  sync(requests: TimerRequest[]): void {
    const wanted = new Map(requests.map((r) => [r.id, r]));
    for (const [id, t] of this.timers) {
      const req = wanted.get(id);
      if (!req || req.at !== t.at || JSON.stringify(req.command) !== t.key) {
        clearTimeout(t.handle);
        this.timers.delete(id);
      }
    }
    for (const req of requests) {
      if (this.timers.has(req.id)) continue;
      const delay = Math.max(0, req.at - this.clock());
      const handle = setTimeout(() => {
        this.timers.delete(req.id);
        this.onTick(req.command);
      }, delay);
      this.timers.set(req.id, { at: req.at, key: JSON.stringify(req.command), handle });
    }
  }

  pending(): { id: string; at: number }[] {
    return [...this.timers].map(([id, t]) => ({ id, at: t.at }));
  }

  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t.handle);
    this.timers.clear();
  }
}
