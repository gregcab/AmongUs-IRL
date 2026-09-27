import type { GameParams } from "./params";
import type {
  Ally,
  ClientView,
  GameOverInfo,
  GhostMeetingMode,
  MeetingSubPhase,
  MeetingType,
  Phase,
  PublicMeetingResult,
  Role,
  Team,
  VoteChoice,
} from "./types";

export type ErrorCode =
  | "WRONG_PHASE"
  | "NOT_ALLOWED"
  | "NOT_AUTHENTICATED"
  | "UNKNOWN_PLAYER"
  | "INVALID_NAME"
  | "NAME_TAKEN"
  | "INVALID_COLOR"
  | "COLOR_TAKEN"
  | "GAME_FULL"
  | "INVALID_PARAMS"
  | "NOT_ENOUGH_PLAYERS"
  | "INVALID_IMPOSTOR_COUNT"
  | "PLAYERS_NOT_READY"
  | "ALREADY_VOTED"
  | "INVALID_TARGET"
  | "EMERGENCY_QUOTA"
  | "EMERGENCY_COOLDOWN"
  | "INVALID_TOKEN"
  | "BAD_PIN"
  | "RATE_LIMITED"
  | "BAD_REQUEST";

export interface GameError {
  code: ErrorCode;
  message: string;
}

/** Acknowledgement returned by every client → server socket event. */
export type Ack<T = undefined> = { ok: true; data?: T } | { ok: false; error: GameError };

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export interface ClientToServerPayloads {
  "lobby:join": { name: string; color: string };
  "lobby:changeColor": { color: string };
  "lobby:ready": Record<string, never>;
  "player:declareDeath": Record<string, never>;
  "player:arrived": Record<string, never>;
  "player:vote": { targetId: VoteChoice };
  /** Short code shown under a body's QR, typed in the app when the camera opens another browser. */
  "player:reportCode": { code: string };

  "admin:auth": { pin: string };
  "admin:updateParams": { params: Partial<GameParams> };
  "admin:kick": { playerId: string };
  "admin:rename": { playerId: string; name: string };
  "admin:start": { force?: boolean };
  "admin:callMeeting": { bodyOfId?: string };
  "admin:advancePhase": Record<string, never>;
  "admin:declareDeath": { playerId: string };
  "admin:revive": { playerId: string };
  "admin:endGame": { winner: Team };
  "admin:backToLobby": Record<string, never>;
}

export type ClientEventName = keyof ClientToServerPayloads;

export const PLAYER_EVENTS = [
  "lobby:join",
  "lobby:changeColor",
  "lobby:ready",
  "player:declareDeath",
  "player:arrived",
  "player:vote",
] as const satisfies readonly ClientEventName[];

export const ADMIN_EVENTS = [
  "admin:updateParams",
  "admin:kick",
  "admin:rename",
  "admin:start",
  "admin:callMeeting",
  "admin:advancePhase",
  "admin:declareDeath",
  "admin:revive",
  "admin:endGame",
  "admin:backToLobby",
] as const satisfies readonly ClientEventName[];

/** Ack payloads that carry data. */
export interface AckData {
  "lobby:join": { token: string };
  "admin:auth": { adminToken: string };
}

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export interface ServerToClientPayloads {
  "player:session": { token: string };
  "player:kicked": Record<string, never>;
  "state:sync": ClientView;
  "lobby:state": { players: { id: string; name: string; color: string; ready: boolean }[]; params: GameParams };
  "game:role": { role: Role; allies: Ally[] };
  "game:phase": { phase: Phase; subPhase?: MeetingSubPhase; endsAt?: number };
  "death:countdown": { endsAt: number };
  "death:confirmed": Record<string, never>;
  "body:qr": { token: string; url: string; code: string; expiresAt: number };
  "kill:cooldownStarted": { endsAt: number };
  "kill:ready": Record<string, never>;
  "meeting:called": { type: MeetingType; reporterId?: string; bodyOfId?: string; ghostMode: GhostMeetingMode };
  "meeting:roster": { alive: string[]; dead: string[]; arrived: string[] };
  "meeting:voteCast": { voterId: string };
  "meeting:result": PublicMeetingResult;
  "game:over": GameOverInfo;
  "admin:deathLogged": { playerId: string; effectiveAt: number };
  error: { code: ErrorCode; message: string };
}

export type ServerEventName = keyof ServerToClientPayloads;

/** Names of REST routes opened by the phone's native camera. */
export const ROUTES = {
  report: "/r/",
  emergency: "/e/",
  /** Reserved for tasks (out of MVP scope). */
  station: "/s/",
} as const;

export const SESSION_HEADER = "x-session-token";
export const SESSION_COOKIE = "amongus_session";
export const ADMIN_COOKIE = "amongus_admin";
