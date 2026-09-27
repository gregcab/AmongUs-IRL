import { PLAYER_COLORS, type GameParams, type GameState } from "@among-us/shared";
import { createInitialState, reduce, seededRng, timersFromState, type Command, type OutboundEvent, type ReduceResult, type Rng } from "../src/engine";

/** Drives the pure engine with a fake clock and an in-memory scheduler. */
export class Harness {
  state: GameState;
  now = 1_700_000_000_000;
  rng: Rng;
  events: OutboundEvent[] = [];

  constructor(params: Partial<GameParams> = {}, seed = 1) {
    this.rng = seededRng(seed);
    this.state = createInitialState("game1");
    this.state.params = { ...this.state.params, ...params };
  }

  try(cmd: Command): ReduceResult {
    const result = reduce(this.state, cmd, this.now, this.rng);
    this.state = result.state;
    this.events.push(...result.events);
    return result;
  }

  do(cmd: Command): ReduceResult {
    const result = this.try(cmd);
    if (result.error) throw new Error(`${cmd.type} rejected: ${result.error.code} ${result.error.message}`);
    return result;
  }

  /** Advances the clock by `ms`, firing every due timer in chronological order. */
  wait(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const next = timersFromState(this.state)
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.now = Math.max(this.now, next.at);
      this.do(next.command);
    }
    this.now = target;
  }

  seconds(s: number): void {
    this.wait(s * 1000);
  }

  clearEvents(): OutboundEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  join(n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `p${i + 1}`;
      this.do({ type: "lobby:join", playerId: id, sessionToken: `tok${i + 1}`, name: `Joueur${i + 1}`, color: PLAYER_COLORS[i]!.id });
      this.now += 10;
      ids.push(id);
    }
    return ids;
  }

  /** Joins `n` ready players, starts and skips the role reveal. */
  startGame(n: number): { impostors: string[]; crew: string[] } {
    const ids = this.join(n);
    for (const id of ids) this.do({ type: "lobby:ready", playerId: id });
    this.do({ type: "admin:start" });
    this.seconds(this.state.params.roleRevealSeconds);
    return this.roles();
  }

  roles(): { impostors: string[]; crew: string[] } {
    const players = Object.values(this.state.players);
    return {
      impostors: players.filter((p) => p.role === "impostor").map((p) => p.id),
      crew: players.filter((p) => p.role === "crew").map((p) => p.id),
    };
  }

  /** Declares a death and waits for it to become effective. */
  kill(victimId: string): void {
    this.do({ type: "player:declareDeath", playerId: victimId });
    this.seconds(this.state.params.deathDelaySeconds);
  }

  status(id: string) {
    return this.state.players[id]!.status;
  }
}
