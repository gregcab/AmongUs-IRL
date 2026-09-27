import { DEFAULT_PARAMS, type GameState } from "@among-us/shared";
import { createInitialState, reduce, timersFromState, type Command, type ReduceResult, type Rng } from "./engine";
import type { Persistence } from "./persistence";
import { Scheduler } from "./scheduler";

export type ResultListener = (result: ReduceResult, command: Command, previous: GameState) => void;

/**
 * Owns the single in-memory game state: every command goes through `dispatch`, which runs
 * the pure engine, journals and snapshots accepted commands, and re-arms timers.
 */
export class GameRuntime {
  private current: GameState;
  private readonly scheduler: Scheduler;
  private readonly listeners: ResultListener[] = [];

  constructor(
    private readonly persistence: Persistence,
    private readonly rng: Rng,
    private readonly clock: () => number,
    timeScale: number,
  ) {
    const restored = persistence.loadSnapshot();
    this.current = restored ?? createInitialState(rng.id(), DEFAULT_PARAMS, timeScale);
    this.current.timeScale = timeScale;
    // Nobody is connected right after a (re)start.
    for (const p of Object.values(this.current.players)) p.connected = false;
    persistence.saveSnapshot(this.current, clock());
    this.scheduler = new Scheduler((tick) => this.dispatch(tick), clock);
    this.scheduler.sync(timersFromState(this.current));
  }

  get state(): GameState {
    return this.current;
  }

  onResult(listener: ResultListener): void {
    this.listeners.push(listener);
  }

  dispatch(command: Command): ReduceResult {
    const previous = this.current;
    const result = reduce(previous, command, this.clock(), this.rng);
    if (result.error || result.state === previous) return result;
    this.current = result.state;
    this.persistence.save(command, result.state, this.clock());
    this.scheduler.sync(result.timers);
    for (const listener of this.listeners) listener(result, command, previous);
    return result;
  }

  pendingTimers() {
    return this.scheduler.pending();
  }

  stop(): void {
    this.scheduler.clear();
  }
}
