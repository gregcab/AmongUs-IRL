import { LIGHT_SWITCHES, PLAYER_COLORS, SABOTAGE_KINDS, SKIP_VOTE, STATION_IDS, taskDef, taskStations, type GameState, type StationId } from "@among-us/shared";
import { describe, expect, it } from "vitest";
import { createInitialState, isAlive, playerView, reduce, seededRng, timersFromState, tvView, type Command, type Rng } from "../src/engine";
import { crewProgress } from "../src/engine/tasks";

// Random games against the pure engine, checking invariants after every accepted or rejected
// command and every timer. Deterministic: a failure prints its seed and the last commands.

const SEEDS = 30;
const STEPS = 150;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

class Fuzz {
  state: GameState;
  now = 1_700_000_000_000;
  readonly engineRng: Rng;
  readonly r: Rng;
  readonly trail: string[] = [];
  readonly endings: string[] = [];
  /** Some runs are bloody, others leave time for the tasks. */
  private readonly deathWeight: number;
  private nextId = 0;

  constructor(seed: number) {
    this.engineRng = seededRng(seed);
    this.r = seededRng(seed * 7919 + 1);
    const players = 4 + this.r.int(7);
    this.deathWeight = this.r.int(2) ? 3 : 0.3;
    this.state = this.initialState();
    for (let i = 0; i < players; i++) this.join();
  }

  private initialState(): GameState {
    const s = createInitialState("game1");
    const r = this.r;
    s.params = {
      ...s.params,
      roleRevealSeconds: 3,
      deathDelaySeconds: r.int(11),
      killCooldownSeconds: 5 + r.int(26),
      emergencyCooldownSeconds: r.int(11),
      emergencyMeetingsPerPlayer: r.int(3),
      gatheringTimeoutSeconds: 10,
      discussionSeconds: 10,
      votingSeconds: 10,
      resumeCountdownSeconds: 3,
      confirmEjects: r.int(2) === 0,
      anonymousVotes: r.int(2) === 0,
      ghostMeetingMode: r.int(2) === 0 ? "cemetery" : "spectator",
      freezeTasksDuringMeeting: r.int(2) === 0,
      taskBarUpdates: pick(r, ["always", "meetings", "never"] as const),
      commonTasks: r.int(2),
      longTasks: r.int(2),
      shortTasks: 1 + r.int(3),
      // Cooperative tasks rarely complete at random: leave them out of half the runs so the crew can win on tasks.
      enabledTasks: r.int(2) ? s.params.enabledTasks : s.params.enabledTasks.filter((t) => !taskDef(t).coop),
      sabotageCriticalSeconds: 15 + r.int(30),
      sabotageCooldownSeconds: 5 + r.int(30),
    };
    return s;
  }

  private join(): void {
    const n = this.nextId++;
    const color = PLAYER_COLORS.find((c) => !Object.values(this.state.players).some((p) => p.color === c.id));
    if (!color) return;
    this.apply({ type: "lobby:join", playerId: `p${n}`, sessionToken: `tok${n}`, name: `Joueur${n}`, color: color.id });
  }

  /** Runs one command on a frozen state (the reducer must not mutate its input) and checks invariants. */
  apply(cmd: Command): void {
    this.trail.push(`${this.now} ${JSON.stringify(cmd)}`);
    if (this.trail.length > 30) this.trail.shift();
    const before = deepFreeze(this.state);
    const result = reduce(before, cmd, this.now, this.engineRng);
    if (result.error || result.state === before) {
      check(result.state === before, "a rejected command returns the same state object");
      check(!result.error || result.events.length === 0, "a rejected command emits nothing");
      // A due timer that changes nothing would stay due forever.
      check(!cmd.type.startsWith("tick:"), `derived timer ${cmd.type} had no effect (${result.error?.code ?? "noop"})`);
      return;
    }
    check(JSON.stringify(result.timers) === JSON.stringify(timersFromState(result.state)), "returned timers match the state");
    if (before.phase !== "GAME_OVER" && result.state.phase === "GAME_OVER") this.endings.push(result.state.winReason!);
    this.state = result.state;
    checkInvariants(this.state);
  }

  /** Advances the clock, firing every derived timer due on the way. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const next = timersFromState(this.state)
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.now = Math.max(this.now, next.at);
      this.apply(next.command);
    }
    this.now = target;
  }

  step(): void {
    const action = pickWeighted(this.r, this.actions());
    action();
  }

  private actions(): [number, () => void][] {
    const s = this.state;
    const r = this.r;
    const ids = Object.keys(s.players);
    const any = () => (ids.length ? pick(r, ids) : "nobody");
    const alive = ids.filter((id) => isAlive(s.players[id]!));
    const crew = ids.filter((id) => s.players[id]!.role === "crew" && s.players[id]!.tasks?.some((t) => !t.done));
    const living = () => (alive.length && r.int(5) > 0 ? pick(r, alive) : any());
    const station = (): StationId => pick(r, STATION_IDS);
    const wait: [number, () => void] = [3, () => this.advance(r.int(r.int(4) === 0 ? 20_000 : 3_000))];

    switch (s.phase) {
      case "LOBBY":
        return [
          wait,
          [6, () => this.apply({ type: "lobby:ready", playerId: any() })],
          [3, () => this.apply({ type: "admin:start", force: r.int(3) === 0 })],
          [ids.length < 12 ? 1 : 0, () => this.join()],
          [0.5, () => this.apply({ type: "admin:kick", playerId: any() })],
          [0.5, () => this.apply({ type: "admin:updateParams", params: { impostorCount: pick(r, ["auto", 1, 2] as const) } })],
          [0.3, () => this.apply({ type: "player:practiceScan", playerId: any() })],
        ];
      case "ROLE_REVEAL":
        return [wait, [0.3, () => this.apply({ type: "admin:advancePhase" })], [0.1, () => this.apply({ type: "admin:backToLobby" })]];
      case "GAME_OVER":
        return [wait, [2, () => this.apply({ type: "admin:backToLobby" })]];
      case "PLAYING":
      case "MEETING": {
        const sab = s.sabotage;
        const repair: [number, () => void][] = sab
          ? [
              [3, () => this.apply({ type: "station:hold", playerId: living(), stationId: pick(r, ["reactor-a", "reactor-b", "shield"] as const), holding: r.int(4) > 0 })],
              [
                2,
                () => {
                  const stationId = pick(r, ["o2-a", "o2-b", "admin"] as const);
                  const code = r.int(4) > 0 ? (sab.codes?.[stationId] ?? "0000") : String(r.int(10_000)).padStart(4, "0");
                  this.apply({ type: "station:code", playerId: living(), stationId, code });
                },
              ],
              [2, () => this.apply({ type: "station:switch", playerId: living(), stationId: "electrical", index: r.int(LIGHT_SWITCHES + 1) })],
              [
                2,
                () => {
                  const target = sab.frequency ?? 50;
                  this.apply({ type: "station:tune", playerId: living(), stationId: "comms", frequency: r.int(2) ? target - 2 + r.int(5) : r.int(101) });
                },
              ],
            ]
          : [];
        return [
          wait,
          ...repair,
          [s.phase === "PLAYING" ? this.deathWeight : 0.5, () => this.apply({ type: "player:declareDeath", playerId: living() })],
          [this.deathWeight / 6, () => this.apply({ type: "admin:declareDeath", playerId: any() })],
          [2, () => this.apply({ type: "player:reportBody", playerId: living(), bodyOfId: any() })],
          [0.7, () => this.apply({ type: "player:emergency", playerId: living() })],
          [0.2, () => this.apply({ type: "admin:callMeeting" })],
          [2, () => this.apply({ type: "player:sabotage", playerId: any(), kind: pick(r, SABOTAGE_KINDS) })],
          [1, () => this.apply({ type: "station:open", playerId: any(), stationId: station() })],
          [s.phase === "PLAYING" ? 8 : 1, () => this.taskStep(r.int(5) && crew.length ? pick(r, crew) : any())],
          [1, () => this.apply({ type: "task:keyTurn", playerId: any(), stationId: pick(r, ["key-a", "key-b"] as const) })],
          [0.6, () => this.apply({ type: "admin:revive", playerId: any() })],
          [0.3, () => this.apply({ type: "admin:repairSabotage" })],
          [0.4, () => this.apply({ type: "admin:completeTask", playerId: any(), taskId: `t${1 + r.int(5)}` })],
          [0.3, () => this.apply({ type: "system:connection", playerId: any(), connected: r.int(2) === 0 })],
          [s.phase === "MEETING" ? 5 : 0, () => this.apply({ type: "player:arrived", playerId: living() })],
          [s.phase === "MEETING" ? 5 : 0, () => this.apply({ type: "player:vote", playerId: living(), targetId: r.int(4) ? any() : SKIP_VOTE })],
          [s.phase === "MEETING" ? 1 : 0, () => this.apply({ type: "admin:advancePhase" })],
          [0.05, () => this.apply({ type: "admin:endGame", winner: pick(r, ["crew", "impostors"] as const) })],
          [0.05, () => this.apply({ type: "admin:backToLobby" })],
        ];
      }
    }
  }

  /** Completes the current step of one of the player's tasks, usually at the right station. */
  private taskStep(playerId: string): void {
    const tasks = this.state.players[playerId]?.tasks?.filter((t) => !t.done) ?? [];
    if (!tasks.length) return;
    const task = pick(this.r, tasks);
    const stations = taskStations(task.type, task.step);
    const stationId = this.r.int(5) > 0 && stations.length ? pick(this.r, stations) : pick(this.r, STATION_IDS);
    if (taskDef(task.type).coop) {
      if (task.type === "doubleKey") this.apply({ type: "task:keyTurn", playerId, stationId });
      else this.apply({ type: "station:hold", playerId, stationId, holding: true });
    } else {
      this.apply({ type: "station:open", playerId, stationId });
      this.apply({ type: "task:complete", playerId, stationId, taskId: task.id });
    }
  }
}

function pick<T>(r: Rng, items: readonly T[]): T {
  return items[r.int(items.length)]!;
}

function pickWeighted(r: Rng, options: [number, () => void][]): () => void {
  const total = options.reduce((sum, [w]) => sum + w, 0);
  let x = (r.int(1_000_000) / 1_000_000) * total;
  for (const [w, action] of options) {
    if (x < w) return action;
    x -= w;
  }
  return options[0]![1];
}

function aliveCounts(s: GameState) {
  const alive = Object.values(s.players).filter(isAlive);
  return { impostors: alive.filter((p) => p.role === "impostor").length, crew: alive.filter((p) => p.role === "crew").length };
}

/** Cheaper than `expect` in a loop of thousands of checks. */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkInvariants(s: GameState): void {
  const players = Object.values(s.players);
  check((s.phase === "MEETING") === (s.meeting !== undefined), "a meeting exists exactly during MEETING");
  for (const p of players) {
    check((p.status === "DYING") === (p.dyingEffectiveAt !== undefined), `${p.id}: DYING iff a death is counting down`);
    for (const t of p.tasks ?? []) {
      const steps = taskDef(t.type).steps.length;
      check(t.step >= 0 && t.step <= steps && t.done === (t.step === steps), `${p.id} task ${t.id}: step ${t.step}, done ${t.done}`);
    }
  }
  check(!s.sabotage || s.phase === "PLAYING", "sabotages only run while playing");
  for (const t of timersFromState(s)) check(Number.isFinite(t.at), `timer ${t.id} has no deadline`);
  const progress = crewProgress(s);
  check(progress.done <= progress.total, "task bar over 100 %");

  switch (s.phase) {
    case "LOBBY":
      for (const p of players) check(p.status === "ALIVE" && !p.role && !p.ejected, `${p.id} not reset in the lobby`);
      check(!s.winner && !s.sabotage && s.kills.length === 0, "game leftovers in the lobby");
      break;
    case "ROLE_REVEAL":
    case "PLAYING":
    case "MEETING": {
      for (const p of players) check(p.role !== undefined, `${p.id} has no role`);
      check(!s.winner, "winner set during the game");
      if (s.phase === "ROLE_REVEAL") break;
      // No win condition may hold while the game goes on.
      const { impostors, crew } = aliveCounts(s);
      check(impostors > 0, "no living impostor but the game goes on");
      check(impostors < crew, `parity (${impostors} vs ${crew}) but the game goes on`);
      check(progress.total === 0 || progress.done < progress.total, "all crew tasks done but the game goes on");
      for (const [voter, target] of Object.entries(s.meeting?.votes ?? {})) {
        check(s.players[voter] !== undefined, `unknown voter ${voter}`);
        check(target === SKIP_VOTE || s.players[target] !== undefined, `unknown vote target ${target}`);
      }
      break;
    }
    case "GAME_OVER":
      check(s.winner !== undefined && s.winReason !== undefined, "game over without a winner");
      for (const p of players) check(p.status !== "DYING", `${p.id}: death still pending after the game`);
      check(!s.sabotage && !s.meeting && s.phaseEndsAt === undefined, "game leftovers after the game");
      break;
  }

  // Anti-cheat: before the end, no crewmate's view and no TV view names a role.
  if (s.phase !== "GAME_OVER" && s.phase !== "LOBBY") {
    const strip = <T extends { meeting?: { result?: unknown } }>(v: T) => ({ ...v, meeting: v.meeting && { ...v.meeting, result: undefined } });
    check(!/"role"|"impostor"/.test(JSON.stringify(strip(tvView(s, "http://x")))), "TV view leaks a role");
    for (const p of players) {
      if (p.role !== "crew") continue;
      const view = playerView(s, p.id);
      check(!/"role"|"impostor"|"allies"/.test(JSON.stringify(strip({ ...view, me: undefined }))), `${p.id}'s view leaks a role`);
    }
  }
}

describe("engine fuzz", () => {
  it(`keeps its invariants over ${SEEDS} random runs`, () => {
    const endings = new Set<string>();
    let games = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const f = new Fuzz(seed);
      try {
        for (let i = 0; i < STEPS; i++) f.step();
      } catch (e) {
        throw new Error(`seed ${seed}, last commands:\n${f.trail.join("\n")}\n${(e as Error).message}`, { cause: e });
      }
      games += f.endings.length;
      for (const reason of f.endings) endings.add(reason);
    }
    // The generator must keep reaching the interesting states, or the fuzz silently tests nothing.
    expect(games).toBeGreaterThanOrEqual(SEEDS / 2);
    expect([...endings].sort()).toEqual(expect.arrayContaining(["impostorsOut", "parity", "tasks"]));
  });
});
