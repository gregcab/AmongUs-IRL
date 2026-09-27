import type { GameParams } from "./params";
import type { SabotageKind, StationId, StationSetup } from "./stations";

export type Role = "crew" | "impostor";
export type Team = "crew" | "impostors";
export type PlayerStatus = "ALIVE" | "DYING" | "BODY" | "GHOST";
export type Phase = "LOBBY" | "ROLE_REVEAL" | "PLAYING" | "MEETING" | "GAME_OVER";
export type MeetingSubPhase = "GATHERING" | "DISCUSSION" | "VOTING" | "RESULT";
export type MeetingType = "body" | "emergency" | "admin";
export type GhostMeetingMode = "cemetery" | "spectator";
export type VoteChoice = string; // player id or SKIP_VOTE
/** Why the game ended. */
export type WinReason = "impostorsOut" | "parity" | "reactor" | "oxygen" | "admin";
export const SKIP_VOTE = "skip";

export interface Player {
  id: string;
  name: string;
  color: string;
  sessionToken: string;
  ready: boolean;
  connected: boolean;
  role?: Role;
  status: PlayerStatus;
  dyingEffectiveAt?: number;
  emergencyUsed: number;
  ejected: boolean;
  joinedAt: number;
  /** Scanned the lobby practice QR from this session's browser (kept across games). */
  scanOk?: boolean;
}

/** Why nobody was ejected: tie at the top, "skip" on top, or no vote at all. */
export type NoEjectionReason = "tie" | "skipped" | "noVotes";

export interface MeetingResult {
  ejectedId: string | null;
  /** Set when `ejectedId` is null. */
  noEjection?: NoEjectionReason;
}

export interface Meeting {
  id: string;
  type: MeetingType;
  reporterId?: string;
  bodyOfId?: string;
  calledAt: number;
  subPhase: MeetingSubPhase;
  endsAt?: number;
  arrived: string[];
  votes: Record<string, VoteChoice>;
  result?: MeetingResult;
}

export interface KillEvent {
  victimId: string;
  declaredAt: number;
  effectiveAt: number;
}

export type TimelineKind = "death" | "ejection" | "revive";

export interface TimelineEntry {
  at: number;
  playerId: string;
  kind: TimelineKind;
}

export interface LogEntry {
  at: number;
  text: string;
}

/** A physical spot with a printed QR code at `/s/:token` (see `stations.ts`). */
export interface Station {
  id: StationId;
  name: string;
  location: string;
}

export interface ActiveSabotage {
  id: string;
  kind: SabotageKind;
  /** Impostor who triggered it (admin only). */
  by: string;
  startedAt: number;
  /** Critical sabotages only: the impostors win at this time unless it is repaired. */
  endsAt?: number;
  /** Oxygen: code expected at each O2 station. */
  codes?: Partial<Record<StationId, string>>;
  /** Oxygen: O2 stations whose code was typed. */
  entered?: StationId[];
  /** Oxygen: players who read the codes at the admin station. */
  codeReaders?: string[];
  /** Lights: switch positions; repaired when they are all on. */
  switches?: boolean[];
}

export interface GameState {
  gameId: string;
  phase: Phase;
  params: GameParams;
  players: Record<string, Player>;
  meeting?: Meeting;
  meetingHistory: Meeting[];
  kills: KillEvent[];
  timeline: TimelineEntry[];
  killCooldownEndsAt?: number;
  /** True once `kill:ready` has been sent for the current cooldown. */
  killReadyNotified?: boolean;
  emergencyCooldownEndsAt?: number;
  phaseEndsAt?: number;
  startedAt?: number;
  winner?: Team;
  winReason?: WinReason;
  /** Dev-only multiplier applied to every game duration (1 in production). */
  timeScale: number;
  log: LogEntry[];
  /** Game-master names and locations of the stations (kept across games). */
  stationSetup?: Partial<Record<StationId, StationSetup>>;
  sabotage?: ActiveSabotage;
  sabotageCooldownEndsAt?: number;
  /** Fingers held on a station: player id → hold expiry (renewed by heartbeats). */
  holds?: Partial<Record<StationId, Record<string, number>>>;
}

// ---------------------------------------------------------------------------
// Client views (payload of `state:sync`). Built server-side, filtered per client.
// ---------------------------------------------------------------------------

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
  /** Publicly known dead (ghost). Unreported bodies stay hidden until a meeting. */
  dead: boolean;
  ejected: boolean;
  /** Passed the lobby scan practice. */
  scanOk: boolean;
}

export interface PublicMeeting {
  id: string;
  type: MeetingType;
  reporterId?: string;
  bodyOfId?: string;
  subPhase: MeetingSubPhase;
  endsAt?: number;
  /** Ids of living players expected to arrive and vote. */
  alive: string[];
  arrived: string[];
  voted: string[];
  result?: PublicMeetingResult;
}

export interface PublicSabotage {
  id: string;
  kind: SabotageKind;
  startedAt: number;
  endsAt?: number;
  /** Reactor: stations with a finger on them. */
  held?: StationId[];
  /** Oxygen: stations whose code was typed. */
  entered?: StationId[];
  /** Oxygen: the codes, only for a player who read them at the admin station. */
  codes?: Partial<Record<StationId, string>>;
  /** Lights: switch positions. */
  switches?: boolean[];
}

export interface PublicMeetingResult {
  ejectedId: string | null;
  noEjection?: NoEjectionReason;
  /** Only with `confirmEjects`, after an ejection. */
  role?: Role;
  /** Living impostors after the ejection; only with `confirmEjects`, after an ejection. */
  impostorsLeft?: number;
  tally?: Record<string, VoteChoice>;
}

export interface MeetingSummary {
  type: MeetingType;
  reporterId?: string;
  bodyOfId?: string;
  calledAt: number;
  /** `undefined` when the game ended before the vote. */
  ejectedId?: string | null;
  noEjection?: NoEjectionReason;
  /** Who voted for whom; omitted when votes are anonymous. */
  tally?: Record<string, VoteChoice>;
}

export interface GameOverInfo {
  winner: Team;
  reason?: WinReason;
  roles: { id: string; name: string; color: string; role: Role }[];
  timeline: TimelineEntry[];
  meetings: MeetingSummary[];
}

export interface Ally {
  id: string;
  name: string;
  color: string;
}

export interface SelfView {
  id: string;
  name: string;
  color: string;
  ready: boolean;
  status: PlayerStatus;
  role?: Role;
  dyingEffectiveAt?: number;
  emergencyUsed: number;
  ejected: boolean;
}

interface BaseView {
  gameId: string;
  phase: Phase;
  phaseEndsAt?: number;
  params: GameParams;
  players: PublicPlayer[];
  meeting?: PublicMeeting;
  gameOver?: GameOverInfo;
  /** Stations used by the current settings. */
  stations: Station[];
  sabotage?: PublicSabotage;
}

export interface PlayerView extends BaseView {
  kind: "player";
  me: SelfView;
  allies?: Ally[];
  /** Impostors only. */
  killCooldownEndsAt?: number;
  /** Impostors only (ghosts included). */
  sabotageCooldownEndsAt?: number;
  emergencyCooldownEndsAt?: number;
  /** Extension point for tasks (out of MVP scope). */
  tasks?: never[];
}

export interface AnonymousView extends BaseView {
  kind: "anonymous";
}

export interface TvView extends BaseView {
  kind: "tv";
  joinUrl: string;
  /** Lobby only: QR code to practice scanning with the phone's camera. */
  practiceUrl?: string;
}

export interface AdminView extends BaseView {
  kind: "admin";
  state: Omit<GameState, "players"> & { players: Record<string, Omit<Player, "sessionToken">> };
  joinUrl: string;
  emergencyUrl: string;
}

export type ClientView = PlayerView | AnonymousView | TvView | AdminView;
