import {
  isValidColor,
  MAX_PLAYERS,
  resolveImpostorCount,
  SKIP_VOTE,
  validateParams,
  type ErrorCode,
  type GameError,
  type GameState,
  type MeetingType,
  type Player,
  type ServerEventName,
  type ServerToClientPayloads,
  type Team,
  type VoteChoice,
} from "@among-us/shared";
import { durationMs, isAlive, nameKey, normalizeName, phaseKey, playersInOrder } from "./state";
import { timersFromState } from "./timers";
import type { Command, OutboundEvent, Recipient, ReduceResult, Rng } from "./types";
import { gameOverInfo, publicResult } from "./views";

const LOG_LIMIT = 300;

type Outcome = GameError | "noop" | void;

class Ctx {
  readonly events: OutboundEvent[] = [];
  constructor(
    readonly s: GameState,
    readonly now: number,
    readonly rng: Rng,
  ) {}

  emit<N extends ServerEventName>(to: Recipient, name: N, payload: ServerToClientPayloads[N]): void {
    this.events.push({ to, name, payload } as OutboundEvent);
  }

  log(text: string): void {
    this.s.log.push({ at: this.now, text });
    if (this.s.log.length > LOG_LIMIT) this.s.log.splice(0, this.s.log.length - LOG_LIMIT);
  }

  ms(seconds: number): number {
    return durationMs(this.s, seconds);
  }

  player(id: string): Player | undefined {
    return this.s.players[id];
  }
}

function fail(code: ErrorCode, message: string): GameError {
  return { code, message };
}

const ALL: Recipient = { group: "all" };

/**
 * Pure, deterministic game engine. Never mutates `state`; a rejected or stale command
 * returns the very same state object.
 */
export function reduce(state: GameState, command: Command, now: number, rng: Rng): ReduceResult {
  const c = new Ctx(structuredClone(state), now, rng);
  const outcome = handle(c, command);
  if (outcome === "noop") return { state, events: [], timers: timersFromState(state) };
  if (outcome) return { state, events: [], timers: timersFromState(state), error: outcome };
  return { state: c.s, events: c.events, timers: timersFromState(c.s) };
}

function handle(c: Ctx, cmd: Command): Outcome {
  switch (cmd.type) {
    case "lobby:join":
      return join(c, cmd.playerId, cmd.sessionToken, cmd.name, cmd.color);
    case "lobby:changeColor":
      return changeColor(c, cmd.playerId, cmd.color);
    case "lobby:ready":
      return ready(c, cmd.playerId);
    case "system:connection":
      return connection(c, cmd.playerId, cmd.connected);
    case "player:declareDeath":
      return declareDeath(c, cmd.playerId);
    case "player:reportBody":
      return reportBody(c, cmd.playerId, cmd.bodyOfId);
    case "player:emergency":
      return emergency(c, cmd.playerId);
    case "player:arrived":
      return arrived(c, cmd.playerId);
    case "player:vote":
      return vote(c, cmd.playerId, cmd.targetId);
    case "admin:updateParams":
      return updateParams(c, cmd.params);
    case "admin:kick":
      return kick(c, cmd.playerId);
    case "admin:rename":
      return rename(c, cmd.playerId, cmd.name);
    case "admin:start":
      return start(c, cmd.force === true);
    case "admin:callMeeting":
      return adminCallMeeting(c, cmd.bodyOfId);
    case "admin:advancePhase":
      return advance(c);
    case "admin:declareDeath":
      return adminDeclareDeath(c, cmd.playerId);
    case "admin:revive":
      return revive(c, cmd.playerId);
    case "admin:endGame":
      return adminEndGame(c, cmd.winner);
    case "admin:backToLobby":
      return backToLobby(c);
    case "tick:phaseEnd":
      return cmd.key === phaseKey(c.s) ? advance(c) : "noop";
    case "tick:deathEffective":
      return deathEffective(c, cmd.playerId, cmd.at);
    case "tick:killReady":
      return killReady(c, cmd.at);
  }
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function nameTaken(s: GameState, name: string, exceptId?: string): boolean {
  const key = nameKey(name);
  return Object.values(s.players).some((p) => p.id !== exceptId && nameKey(p.name) === key);
}

function colorTaken(s: GameState, color: string, exceptId?: string): boolean {
  return Object.values(s.players).some((p) => p.id !== exceptId && p.color === color);
}

function emitLobby(c: Ctx): void {
  c.emit(ALL, "lobby:state", {
    players: playersInOrder(c.s).map((p) => ({ id: p.id, name: p.name, color: p.color, ready: p.ready })),
    params: { ...c.s.params },
  });
}

function join(c: Ctx, playerId: string, sessionToken: string, rawName: string, color: string): Outcome {
  if (c.s.phase !== "LOBBY") return fail("WRONG_PHASE", "La partie a déjà commencé");
  if (c.player(playerId)) return fail("NOT_ALLOWED", "Déjà inscrit");
  if (Object.keys(c.s.players).length >= MAX_PLAYERS) return fail("GAME_FULL", "La partie est complète");
  const name = normalizeName(rawName);
  if (!name) return fail("INVALID_NAME", "Pseudo invalide (1 à 16 caractères)");
  if (nameTaken(c.s, name)) return fail("NAME_TAKEN", "Ce pseudo est déjà pris");
  if (!isValidColor(color)) return fail("INVALID_COLOR", "Couleur invalide");
  if (colorTaken(c.s, color)) return fail("COLOR_TAKEN", "Cette couleur est déjà prise");
  c.s.players[playerId] = {
    id: playerId,
    name,
    color,
    sessionToken,
    ready: false,
    connected: true,
    status: "ALIVE",
    emergencyUsed: 0,
    ejected: false,
    joinedAt: c.now,
  };
  c.log(`${name} a rejoint la partie`);
  emitLobby(c);
}

function changeColor(c: Ctx, playerId: string, color: string): Outcome {
  if (c.s.phase !== "LOBBY") return fail("WRONG_PHASE", "La couleur ne peut plus être changée");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (!isValidColor(color)) return fail("INVALID_COLOR", "Couleur invalide");
  if (p.color === color) return "noop";
  if (colorTaken(c.s, color, playerId)) return fail("COLOR_TAKEN", "Cette couleur est déjà prise");
  p.color = color;
  emitLobby(c);
}

function ready(c: Ctx, playerId: string): Outcome {
  if (c.s.phase !== "LOBBY") return fail("WRONG_PHASE", "La partie a déjà commencé");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (p.ready) return "noop";
  p.ready = true;
  c.log(`${p.name} est prêt`);
  emitLobby(c);
}

function connection(c: Ctx, playerId: string, connected: boolean): Outcome {
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (p.connected === connected) return "noop";
  p.connected = connected;
  c.log(`${p.name} ${connected ? "s'est reconnecté" : "s'est déconnecté"}`);
}

function updateParams(c: Ctx, update: unknown): Outcome {
  if (c.s.phase !== "LOBBY") return fail("WRONG_PHASE", "Les paramètres sont figés pendant la partie");
  const result = validateParams(c.s.params, update);
  if (!result.ok) return fail("INVALID_PARAMS", result.errors.join(" ; "));
  c.s.params = result.params;
  c.log("Paramètres mis à jour");
  emitLobby(c);
}

function kick(c: Ctx, playerId: string): Outcome {
  if (c.s.phase !== "LOBBY") return fail("WRONG_PHASE", "Exclusion possible uniquement dans le lobby");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  delete c.s.players[playerId];
  c.emit({ player: playerId }, "player:kicked", {});
  c.log(`${p.name} a été exclu`);
  emitLobby(c);
}

function rename(c: Ctx, playerId: string, rawName: string): Outcome {
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  const name = normalizeName(rawName);
  if (!name) return fail("INVALID_NAME", "Pseudo invalide (1 à 16 caractères)");
  if (nameTaken(c.s, name, playerId)) return fail("NAME_TAKEN", "Ce pseudo est déjà pris");
  if (p.name === name) return "noop";
  c.log(`${p.name} renommé en ${name}`);
  p.name = name;
  if (c.s.phase === "LOBBY") emitLobby(c);
}

function start(c: Ctx, force: boolean): Outcome {
  const s = c.s;
  if (s.phase !== "LOBBY") return fail("WRONG_PHASE", "La partie a déjà commencé");
  const players = playersInOrder(s);
  const n = players.length;
  if (n < s.params.minPlayers) {
    return fail("NOT_ENOUGH_PLAYERS", `Il faut au moins ${s.params.minPlayers} joueurs (${n} inscrits)`);
  }
  const impostors = resolveImpostorCount(s.params.impostorCount, n);
  if (impostors === null) {
    return fail("INVALID_IMPOSTOR_COUNT", `Nombre d'imposteurs invalide pour ${n} joueurs`);
  }
  const notReady = players.filter((p) => !p.ready);
  if (notReady.length > 0 && !force) {
    return fail("PLAYERS_NOT_READY", `Pas prêts : ${notReady.map((p) => p.name).join(", ")}`);
  }

  // Fisher–Yates shuffle, then the first `impostors` players are impostors.
  const order = players.map((p) => p.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = c.rng.int(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const impostorIds = new Set(order.slice(0, impostors));

  for (const p of players) {
    p.role = impostorIds.has(p.id) ? "impostor" : "crew";
    p.status = "ALIVE";
    p.emergencyUsed = 0;
    p.ejected = false;
    delete p.dyingEffectiveAt;
  }
  s.phase = "ROLE_REVEAL";
  s.startedAt = c.now;
  s.phaseEndsAt = c.now + c.ms(s.params.roleRevealSeconds);
  s.meeting = undefined;
  s.meetingHistory = [];
  s.kills = [];
  s.timeline = [];
  s.winner = undefined;

  for (const p of players) {
    const allies =
      p.role === "impostor"
        ? players.filter((o) => o.id !== p.id && o.role === "impostor").map((o) => ({ id: o.id, name: o.name, color: o.color }))
        : [];
    c.emit({ player: p.id }, "game:role", { role: p.role!, allies });
  }
  c.log(`Partie lancée${notReady.length > 0 ? " (forcée)" : ""} : ${n} joueurs, ${impostors} imposteur(s)`);
  emitPhase(c);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

function emitPhase(c: Ctx): void {
  const m = c.s.phase === "MEETING" ? c.s.meeting : undefined;
  c.emit(ALL, "game:phase", { phase: c.s.phase, subPhase: m?.subPhase, endsAt: c.s.phaseEndsAt });
}

function startCooldowns(c: Ctx): void {
  restartKillCooldown(c);
  c.s.emergencyCooldownEndsAt = c.now + c.ms(c.s.params.emergencyCooldownSeconds);
}

function restartKillCooldown(c: Ctx): void {
  const endsAt = c.now + c.ms(c.s.params.killCooldownSeconds);
  c.s.killCooldownEndsAt = endsAt;
  c.s.killReadyNotified = false;
  c.emit({ group: "impostors" }, "kill:cooldownStarted", { endsAt });
}

function advance(c: Ctx): Outcome {
  const s = c.s;
  if (s.phase === "ROLE_REVEAL") {
    s.phase = "PLAYING";
    s.phaseEndsAt = undefined;
    c.log("Début du jeu");
    startCooldowns(c);
    emitPhase(c);
    return;
  }
  if (s.phase === "MEETING" && s.meeting) {
    switch (s.meeting.subPhase) {
      case "GATHERING":
        return setSubPhase(c, "DISCUSSION", s.params.discussionSeconds);
      case "DISCUSSION":
        return setSubPhase(c, "VOTING", s.params.votingSeconds);
      case "VOTING":
        return resolveVote(c);
      case "RESULT":
        return resumePlaying(c);
    }
  }
  return fail("WRONG_PHASE", "Aucune phase à faire avancer");
}

function setSubPhase(c: Ctx, sub: "DISCUSSION" | "VOTING", seconds: number): void {
  const m = c.s.meeting!;
  m.subPhase = sub;
  m.endsAt = c.now + c.ms(seconds);
  c.s.phaseEndsAt = m.endsAt;
  c.log(sub === "DISCUSSION" ? "Début de la discussion" : "Début du vote");
  emitPhase(c);
}

function resumePlaying(c: Ctx): void {
  const s = c.s;
  s.meetingHistory.push(s.meeting!);
  s.meeting = undefined;
  s.phase = "PLAYING";
  s.phaseEndsAt = undefined;
  c.log("Reprise du jeu");
  startCooldowns(c);
  emitPhase(c);
}

// ---------------------------------------------------------------------------
// Deaths
// ---------------------------------------------------------------------------

function declareDeath(c: Ctx, playerId: string): Outcome {
  if (c.s.phase === "MEETING") return fail("WRONG_PHASE", "Impossible pendant une réunion");
  if (c.s.phase !== "PLAYING") return fail("WRONG_PHASE", "La partie n'est pas en cours");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (p.status !== "ALIVE") return fail("NOT_ALLOWED", p.status === "DYING" ? "Mort déjà déclarée" : "Tu es déjà mort");
  const effectiveAt = c.now + c.ms(c.s.params.deathDelaySeconds);
  p.status = "DYING";
  p.dyingEffectiveAt = effectiveAt;
  c.s.kills.push({ victimId: p.id, declaredAt: c.now, effectiveAt });
  c.emit({ player: p.id }, "death:countdown", { endsAt: effectiveAt });
  c.emit({ group: "admin" }, "admin:deathLogged", { playerId: p.id, effectiveAt });
  c.log(`${p.name} a déclaré sa mort`);
}

/** DYING or ALIVE → BODY. */
function finalizeDeath(c: Ctx, p: Player): void {
  p.status = "BODY";
  delete p.dyingEffectiveAt;
  c.s.timeline.push({ at: c.now, playerId: p.id, kind: "death" });
  c.emit({ player: p.id }, "death:confirmed", {});
  c.log(`Mort effective de ${p.name}`);
}

function deathEffective(c: Ctx, playerId: string, at: number): Outcome {
  const p = c.player(playerId);
  if (c.s.phase !== "PLAYING" || !p || p.status !== "DYING" || p.dyingEffectiveAt !== at) return "noop";
  finalizeDeath(c, p);
  restartKillCooldown(c);
  checkWin(c);
}

function killReady(c: Ctx, at: number): Outcome {
  if (c.s.phase !== "PLAYING" || c.s.killCooldownEndsAt !== at || c.s.killReadyNotified) return "noop";
  c.s.killReadyNotified = true;
  c.emit({ group: "impostors" }, "kill:ready", {});
}

function adminDeclareDeath(c: Ctx, playerId: string): Outcome {
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (!isAlive(p)) return fail("NOT_ALLOWED", "Ce joueur est déjà mort");
  if (c.s.phase === "PLAYING") {
    finalizeDeath(c, p);
    restartKillCooldown(c);
    checkWin(c);
    return;
  }
  if (c.s.phase === "MEETING" && c.s.meeting) {
    const m = c.s.meeting;
    p.status = "GHOST";
    delete p.dyingEffectiveAt;
    m.arrived = m.arrived.filter((id) => id !== p.id);
    delete m.votes[p.id];
    c.s.timeline.push({ at: c.now, playerId: p.id, kind: "death" });
    c.log(`${p.name} déclaré mort par le MJ`);
    if (checkWin(c)) return;
    if (m.subPhase === "GATHERING" && allArrived(c.s)) setSubPhase(c, "DISCUSSION", c.s.params.discussionSeconds);
    else if (m.subPhase === "VOTING" && allVoted(c.s)) resolveVote(c);
    else emitRoster(c);
    return;
  }
  return fail("WRONG_PHASE", "La partie n'est pas en cours");
}

function revive(c: Ctx, playerId: string): Outcome {
  if (c.s.phase !== "PLAYING" && c.s.phase !== "MEETING") return fail("WRONG_PHASE", "La partie n'est pas en cours");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  const revivable = p.status === "DYING" || p.status === "BODY" || (p.status === "GHOST" && !p.ejected);
  if (!revivable) return fail("NOT_ALLOWED", "Réanimation impossible pour ce joueur");
  p.status = "ALIVE";
  delete p.dyingEffectiveAt;
  c.s.timeline.push({ at: c.now, playerId: p.id, kind: "revive" });
  c.log(`${p.name} réanimé par le MJ`);
  if (c.s.phase === "MEETING") emitRoster(c);
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

function reportBody(c: Ctx, playerId: string, bodyOfId: string): Outcome {
  if (c.s.phase === "MEETING") return fail("WRONG_PHASE", "Une réunion est déjà en cours");
  if (c.s.phase !== "PLAYING") return fail("WRONG_PHASE", "La partie n'est pas en cours");
  const reporter = c.player(playerId);
  if (!reporter) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (!isAlive(reporter)) return fail("NOT_ALLOWED", "Seuls les vivants peuvent signaler un corps");
  const body = c.player(bodyOfId);
  if (!body || body.status !== "BODY") return fail("INVALID_TARGET", "Ce corps ne peut plus être signalé");
  startMeeting(c, "body", reporter.id, body.id);
}

function emergency(c: Ctx, playerId: string): Outcome {
  if (c.s.phase === "MEETING") return fail("WRONG_PHASE", "Une réunion est déjà en cours");
  if (c.s.phase !== "PLAYING") return fail("WRONG_PHASE", "La partie n'est pas en cours");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (!isAlive(p)) return fail("NOT_ALLOWED", "Les morts ne peuvent pas appeler de réunion");
  if (p.emergencyUsed >= c.s.params.emergencyMeetingsPerPlayer) {
    return fail("EMERGENCY_QUOTA", "Plus de réunion d'urgence disponible");
  }
  const readyAt = c.s.emergencyCooldownEndsAt ?? 0;
  if (c.now < readyAt) {
    return fail("EMERGENCY_COOLDOWN", `Bouton disponible dans ${Math.ceil((readyAt - c.now) / 1000)} s`);
  }
  p.emergencyUsed += 1;
  startMeeting(c, "emergency", p.id);
}

function adminCallMeeting(c: Ctx, bodyOfId?: string): Outcome {
  if (c.s.phase !== "PLAYING") return fail("WRONG_PHASE", "La partie n'est pas en cours");
  if (bodyOfId !== undefined) {
    const body = c.player(bodyOfId);
    if (!body || (body.status !== "BODY" && body.status !== "DYING")) {
      return fail("INVALID_TARGET", "Ce joueur n'est pas un corps");
    }
    startMeeting(c, "body", undefined, bodyOfId);
    return;
  }
  startMeeting(c, "admin");
}

function startMeeting(c: Ctx, type: MeetingType, reporterId?: string, bodyOfId?: string): void {
  const s = c.s;
  const players = playersInOrder(s);
  for (const p of players) if (p.status === "DYING") finalizeDeath(c, p);
  for (const p of players) if (p.status === "BODY") p.status = "GHOST";
  s.killCooldownEndsAt = undefined;
  s.killReadyNotified = false;

  const meeting = {
    id: c.rng.id(),
    type,
    reporterId,
    bodyOfId,
    calledAt: c.now,
    subPhase: "GATHERING" as const,
    endsAt: c.now + c.ms(s.params.gatheringTimeoutSeconds),
    arrived: [],
    votes: {},
  };
  s.meeting = meeting;
  s.phase = "MEETING";
  s.phaseEndsAt = meeting.endsAt;

  c.emit(ALL, "meeting:called", { type, reporterId, bodyOfId, ghostMode: s.params.ghostMeetingMode });
  const reporter = reporterId ? s.players[reporterId]?.name : "le MJ";
  const body = bodyOfId ? s.players[bodyOfId]?.name : undefined;
  c.log(body ? `Corps de ${body} signalé par ${reporter}` : `Réunion d'urgence appelée par ${reporter}`);

  if (checkWin(c)) return;
  emitPhase(c);
  emitRoster(c);
}

function allArrived(s: GameState): boolean {
  const arrived = new Set(s.meeting?.arrived);
  return Object.values(s.players).every((p) => p.status !== "ALIVE" || arrived.has(p.id));
}

function allVoted(s: GameState): boolean {
  const votes = s.meeting?.votes ?? {};
  return Object.values(s.players).every((p) => p.status !== "ALIVE" || p.id in votes);
}

function emitRoster(c: Ctx): void {
  const players = playersInOrder(c.s);
  c.emit(ALL, "meeting:roster", {
    alive: players.filter((p) => p.status === "ALIVE").map((p) => p.id),
    dead: players.filter((p) => p.status === "GHOST").map((p) => p.id),
    arrived: [...(c.s.meeting?.arrived ?? [])],
  });
}

function arrived(c: Ctx, playerId: string): Outcome {
  const m = c.s.meeting;
  if (c.s.phase !== "MEETING" || !m || m.subPhase !== "GATHERING") return fail("WRONG_PHASE", "Le rassemblement est terminé");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (p.status !== "ALIVE") return fail("NOT_ALLOWED", "Seuls les vivants se rassemblent");
  if (m.arrived.includes(p.id)) return "noop";
  m.arrived.push(p.id);
  emitRoster(c);
  if (allArrived(c.s)) setSubPhase(c, "DISCUSSION", c.s.params.discussionSeconds);
}

function vote(c: Ctx, playerId: string, targetId: VoteChoice): Outcome {
  const m = c.s.meeting;
  if (c.s.phase !== "MEETING" || !m || m.subPhase !== "VOTING") return fail("WRONG_PHASE", "Le vote n'est pas ouvert");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (p.status !== "ALIVE") return fail("NOT_ALLOWED", "Seuls les vivants votent");
  if (p.id in m.votes) return fail("ALREADY_VOTED", "Vote déjà enregistré");
  if (targetId !== SKIP_VOTE && c.player(targetId)?.status !== "ALIVE") return fail("INVALID_TARGET", "Cible invalide");
  m.votes[p.id] = targetId;
  c.emit(ALL, "meeting:voteCast", { voterId: p.id });
  if (allVoted(c.s)) resolveVote(c);
}

/** Relative majority; a tie at the top or "skip" on top ejects nobody. */
export function computeEjection(votes: Record<string, VoteChoice>): string | null {
  const counts = new Map<VoteChoice, number>();
  for (const target of Object.values(votes)) counts.set(target, (counts.get(target) ?? 0) + 1);
  let best: VoteChoice | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [target, count] of counts) {
    if (count > bestCount) {
      best = target;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  if (best === null || tie || best === SKIP_VOTE) return null;
  return best;
}

function resolveVote(c: Ctx): void {
  const s = c.s;
  const m = s.meeting!;
  const ejectedId = computeEjection(m.votes);
  m.subPhase = "RESULT";
  m.result = { ejectedId };
  if (ejectedId) {
    const p = s.players[ejectedId]!;
    p.status = "GHOST";
    p.ejected = true;
    s.timeline.push({ at: c.now, playerId: p.id, kind: "ejection" });
    c.log(`${p.name} a été éjecté`);
  } else {
    c.log("Personne n'a été éjecté");
  }
  c.emit(ALL, "meeting:result", publicResult(s, m)!);
  if (checkWin(c)) return;
  m.endsAt = c.now + c.ms(s.params.resumeCountdownSeconds);
  s.phaseEndsAt = m.endsAt;
  emitPhase(c);
}

// ---------------------------------------------------------------------------
// End of game
// ---------------------------------------------------------------------------

/** Ends the game if a team has won. Returns true when the game is over. */
function checkWin(c: Ctx): boolean {
  if (c.s.phase !== "PLAYING" && c.s.phase !== "MEETING") return false;
  let impostors = 0;
  let crew = 0;
  for (const p of Object.values(c.s.players)) {
    if (!isAlive(p)) continue;
    if (p.role === "impostor") impostors++;
    else crew++;
  }
  if (impostors === 0) endGame(c, "crew");
  else if (impostors >= crew) endGame(c, "impostors");
  else return false;
  return true;
}

function endGame(c: Ctx, winner: Team): void {
  const s = c.s;
  if (s.meeting) s.meetingHistory.push(s.meeting);
  s.meeting = undefined;
  s.phase = "GAME_OVER";
  s.winner = winner;
  s.phaseEndsAt = undefined;
  s.killCooldownEndsAt = undefined;
  s.killReadyNotified = false;
  s.emergencyCooldownEndsAt = undefined;
  c.log(`Victoire ${winner === "crew" ? "des équipiers" : "des imposteurs"}`);
  emitPhase(c);
  c.emit(ALL, "game:over", gameOverInfo(s)!);
}

function adminEndGame(c: Ctx, winner: Team): Outcome {
  if (c.s.phase !== "ROLE_REVEAL" && c.s.phase !== "PLAYING" && c.s.phase !== "MEETING") {
    return fail("WRONG_PHASE", "La partie n'est pas en cours");
  }
  if (winner !== "crew" && winner !== "impostors") return fail("BAD_REQUEST", "Vainqueur invalide");
  c.log("Fin de partie décidée par le MJ");
  endGame(c, winner);
}

function backToLobby(c: Ctx): Outcome {
  const s = c.s;
  if (s.phase !== "GAME_OVER") return fail("WRONG_PHASE", "La partie n'est pas terminée");
  s.gameId = c.rng.id();
  s.phase = "LOBBY";
  for (const p of Object.values(s.players)) {
    p.ready = false;
    p.role = undefined;
    p.status = "ALIVE";
    p.emergencyUsed = 0;
    p.ejected = false;
    delete p.dyingEffectiveAt;
  }
  s.meeting = undefined;
  s.meetingHistory = [];
  s.kills = [];
  s.timeline = [];
  s.winner = undefined;
  s.startedAt = undefined;
  s.phaseEndsAt = undefined;
  s.killCooldownEndsAt = undefined;
  s.killReadyNotified = false;
  s.emergencyCooldownEndsAt = undefined;
  c.log("Retour au lobby");
  emitPhase(c);
  emitLobby(c);
}
