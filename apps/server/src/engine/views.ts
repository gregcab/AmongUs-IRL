import type {
  AdminView,
  AnonymousView,
  GameOverInfo,
  GameState,
  Meeting,
  PlayerView,
  PublicMeeting,
  PublicMeetingResult,
  PublicPlayer,
  TvView,
} from "@among-us/shared";
import { isAlive, playersInOrder } from "./state";

// Every function here decides what a given client may know. Role information must only
// reach its owner, fellow impostors, the admin, or everybody once the game is over.

export function publicPlayers(s: GameState): PublicPlayer[] {
  return playersInOrder(s).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    ready: p.ready,
    connected: p.connected,
    dead: p.status === "GHOST",
    ejected: p.ejected,
  }));
}

export function publicResult(s: GameState, m: Meeting): PublicMeetingResult | undefined {
  if (!m.result) return undefined;
  const { ejectedId, noEjection } = m.result;
  const result: PublicMeetingResult = { ejectedId };
  if (noEjection) result.noEjection = noEjection;
  if (ejectedId && s.params.confirmEjects) {
    result.role = s.players[ejectedId]?.role;
    result.impostorsLeft = Object.values(s.players).filter((p) => p.role === "impostor" && isAlive(p)).length;
  }
  if (!s.params.anonymousVotes) result.tally = { ...m.votes };
  return result;
}

function publicMeeting(s: GameState): PublicMeeting | undefined {
  const m = s.meeting;
  if (!m || s.phase !== "MEETING") return undefined;
  return {
    id: m.id,
    type: m.type,
    reporterId: m.reporterId,
    bodyOfId: m.bodyOfId,
    subPhase: m.subPhase,
    endsAt: m.endsAt,
    alive: playersInOrder(s).filter((p) => p.status === "ALIVE").map((p) => p.id),
    arrived: [...m.arrived],
    voted: Object.keys(m.votes),
    result: publicResult(s, m),
  };
}

export function gameOverInfo(s: GameState): GameOverInfo | undefined {
  if (s.phase !== "GAME_OVER" || !s.winner) return undefined;
  return {
    winner: s.winner,
    roles: playersInOrder(s).map((p) => ({ id: p.id, name: p.name, color: p.color, role: p.role ?? "crew" })),
    timeline: s.timeline.map((t) => ({ ...t })),
    meetings: s.meetingHistory.map((m) => ({
      type: m.type,
      reporterId: m.reporterId,
      bodyOfId: m.bodyOfId,
      calledAt: m.calledAt,
      ejectedId: m.result?.ejectedId,
      noEjection: m.result?.noEjection,
      tally: m.result && !s.params.anonymousVotes ? { ...m.votes } : undefined,
    })),
  };
}

function baseView(s: GameState) {
  return {
    gameId: s.gameId,
    phase: s.phase,
    phaseEndsAt: s.phaseEndsAt,
    params: { ...s.params },
    players: publicPlayers(s),
    meeting: publicMeeting(s),
    gameOver: gameOverInfo(s),
  };
}

export function playerView(s: GameState, playerId: string): PlayerView | AnonymousView {
  const p = s.players[playerId];
  if (!p) return anonymousView(s);
  const revealed = s.phase !== "LOBBY";
  const isImpostor = revealed && p.role === "impostor";
  const view: PlayerView = {
    kind: "player",
    ...baseView(s),
    me: {
      id: p.id,
      name: p.name,
      color: p.color,
      ready: p.ready,
      status: p.status,
      role: revealed ? p.role : undefined,
      dyingEffectiveAt: p.dyingEffectiveAt,
      emergencyUsed: p.emergencyUsed,
      ejected: p.ejected,
    },
  };
  if (isImpostor) {
    view.allies = playersInOrder(s)
      .filter((o) => o.id !== p.id && o.role === "impostor")
      .map((o) => ({ id: o.id, name: o.name, color: o.color }));
    if (s.phase === "PLAYING" && isAlive(p)) view.killCooldownEndsAt = s.killCooldownEndsAt;
  }
  if (s.phase === "PLAYING") view.emergencyCooldownEndsAt = s.emergencyCooldownEndsAt;
  return view;
}

export function anonymousView(s: GameState): AnonymousView {
  return { kind: "anonymous", ...baseView(s) };
}

export function tvView(s: GameState, joinUrl: string): TvView {
  return { kind: "tv", ...baseView(s), joinUrl };
}

export function adminView(s: GameState, joinUrl: string, emergencyUrl: string): AdminView {
  const players = Object.fromEntries(
    Object.values(s.players).map(({ sessionToken: _hidden, ...rest }) => [rest.id, rest]),
  );
  return { kind: "admin", ...baseView(s), state: { ...structuredClone(s), players }, joinUrl, emergencyUrl };
}
