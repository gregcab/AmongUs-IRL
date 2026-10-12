import { DEFAULT_PARAMS, type GameState } from "@among-us/shared";
import { createInitialState, reduce, timersFromState, upgradeState, type Command, type ReduceResult, type Rng } from "./engine";
import type { Persistence } from "./persistence";
import { Scheduler } from "./scheduler";

/**
 * Commands that only move a finger's heartbeat, a radio dial or a connection flag. They are not journaled
 * and, unless they emit an event (a reactor repaired with two hands), their snapshot is
 * deferred: a phone holding a station sends one every 1.5 s, which would rewrite the whole
 * state on the Pi's SD card each time. Losing them on a crash is harmless: fingers expire
 * after 4 s and everybody is marked disconnected at startup.
 */
const VOLATILE_COMMANDS: ReadonlySet<Command["type"]> = new Set([
  "station:hold",
  "station:tune",
  "tick:holdExpired",
  "system:connection",
]);
const DEFERRED_SNAPSHOT_MS = 5_000;

export type ResultListener = (result: ReduceResult, command: Command, previous: GameState) => void;

/**
 * Owns the single in-memory game state: every command goes through `dispatch`, which runs
 * the pure engine, journals and snapshots accepted commands, and re-arms timers.
 */
export class GameRuntime {
  private current: GameState;
  private readonly scheduler: Scheduler;
  private readonly listeners: ResultListener[] = [];
  private stopped = false;
  private pendingSnapshot?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly persistence: Persistence,
    private readonly rng: Rng,
    private readonly clock: () => number,
    timeScale: number,
  ) {
    const restored = persistence.loadSnapshot();
    this.current = restored ? upgradeState(restored) : createInitialState(rng.id(), DEFAULT_PARAMS, timeScale);
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
    // Sockets closing during shutdown must not re-arm timers or write to a closed database.
    if (this.stopped) return { state: previous, events: [], timers: [], error: { code: "WRONG_PHASE", message: "Serveur arrêté" } };
    let result: ReduceResult;
    try {
      result = reduce(previous, command, this.clock(), this.rng);
    } catch (err) {
      // A bug in the engine must not take the whole game down (Socket.IO handlers run in nextTick).
      console.error(`[game] ${command.type} a échoué`, err);
      return { state: previous, events: [], timers: [], error: { code: "BAD_REQUEST", message: "Erreur interne du serveur" } };
    }
    if (result.error || result.state === previous) return result;
    this.current = result.state;
    if (VOLATILE_COMMANDS.has(command.type) && result.events.length === 0) {
      this.pendingSnapshot ??= setTimeout(() => this.flushSnapshot(), DEFERRED_SNAPSHOT_MS);
    } else {
      this.cancelPendingSnapshot();
      this.persistence.save(command, result.state, this.clock());
      // The journal keeps the current game and the previous one only.
      if (result.state.gameId !== previous.gameId) this.persistence.pruneJournal([previous.gameId, result.state.gameId]);
    }
    this.scheduler.sync(result.timers);
    for (const listener of this.listeners) listener(result, command, previous);
    return result;
  }

  pendingTimers() {
    return this.scheduler.pending();
  }

  stop(): void {
    if (this.pendingSnapshot !== undefined) this.flushSnapshot();
    this.stopped = true;
    this.scheduler.clear();
  }

  private flushSnapshot(): void {
    this.cancelPendingSnapshot();
    if (!this.stopped) this.persistence.saveSnapshot(this.current, this.clock());
  }

  private cancelPendingSnapshot(): void {
    if (this.pendingSnapshot !== undefined) clearTimeout(this.pendingSnapshot);
    this.pendingSnapshot = undefined;
  }
}
