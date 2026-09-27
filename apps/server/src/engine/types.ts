import type {
  ClientToServerPayloads,
  GameError,
  GameParams,
  GameState,
  ServerEventName,
  ServerToClientPayloads,
  Team,
  VoteChoice,
} from "@among-us/shared";

export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Opaque unique identifier. */
  id(): string;
}

type PlayerCommand<T extends string, P = {}> = { type: T; playerId: string } & P;

export type Command =
  // Players
  | PlayerCommand<"lobby:join", { sessionToken: string; name: string; color: string }>
  | PlayerCommand<"lobby:changeColor", { color: string }>
  | PlayerCommand<"lobby:ready">
  | PlayerCommand<"player:declareDeath">
  | PlayerCommand<"player:arrived">
  | PlayerCommand<"player:vote", { targetId: VoteChoice }>
  /** Body QR scanned; the token signature has already been checked by the transport layer. */
  | PlayerCommand<"player:reportBody", { bodyOfId: string }>
  /** Emergency station QR scanned; token already checked by the transport layer. */
  | PlayerCommand<"player:emergency">
  /** Lobby practice QR scanned from a browser holding the player's session. */
  | PlayerCommand<"player:practiceScan">
  | PlayerCommand<"system:connection", { connected: boolean }>
  // Admin
  | { type: "admin:updateParams"; params: Partial<GameParams> }
  | { type: "admin:kick"; playerId: string }
  | { type: "admin:rename"; playerId: string; name: string }
  | { type: "admin:start"; force?: boolean }
  | { type: "admin:callMeeting"; bodyOfId?: string }
  | { type: "admin:advancePhase" }
  | { type: "admin:declareDeath"; playerId: string }
  | { type: "admin:revive"; playerId: string }
  | { type: "admin:endGame"; winner: Team }
  | { type: "admin:backToLobby" }
  // Scheduler
  | { type: "tick:phaseEnd"; key: string }
  | { type: "tick:deathEffective"; playerId: string; at: number }
  | { type: "tick:killReady"; at: number };

export type CommandType = Command["type"];
export type TickCommand = Extract<Command, { type: `tick:${string}` }>;

// Compile-time guard: every admin command of the shared contract exists in the engine.
type _AdminCovered = Exclude<Extract<keyof ClientToServerPayloads, `admin:${string}`>, CommandType | "admin:auth">;
const _adminCovered: [_AdminCovered] extends [never] ? true : never = true;
void _adminCovered;

export type Group = "alive" | "impostors" | "ghosts" | "tv" | "admin" | "all";

export type Recipient = { player: string } | { group: Group };

export interface OutboundEvent<N extends ServerEventName = ServerEventName> {
  to: Recipient;
  name: N;
  payload: ServerToClientPayloads[N];
}

export interface TimerRequest {
  /** Stable id: a new request with the same id replaces the previous one. */
  id: string;
  at: number;
  command: TickCommand;
}

export interface ReduceResult {
  state: GameState;
  events: OutboundEvent[];
  /** Full set of timers the scheduler must hold after this command. */
  timers: TimerRequest[];
  /** Set when the command was rejected; `state` is then unchanged. */
  error?: GameError;
}
