import {
  ADMIN_EVENTS,
  PLAYER_EVENTS,
  type Ack,
  type ClientEventName,
  type ClientToServerPayloads,
  type ClientView,
  type GameError,
  type GameState,
  type ServerToClientPayloads,
} from "@among-us/shared";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { AdminAuth, newPlayerId, newSessionToken } from "../auth";
import { adminView, anonymousView, isAlive, playerView, tvView, type Command, type OutboundEvent, type ReduceResult } from "../engine";
import type { GameRuntime } from "../game";
import { Tokens } from "../tokens";

type AckFn = (res: Ack<unknown>) => void;

type ClientToServerEvents = {
  [K in ClientEventName]: (payload: ClientToServerPayloads[K], ack?: AckFn) => void;
} & {
  "clock:sync": (ack: (serverNow: number) => void) => void;
  "state:request": () => void;
};

type ServerToClientEvents = {
  [K in keyof ServerToClientPayloads]: (payload: ServerToClientPayloads[K]) => void;
};

export interface SocketData {
  kind: "anonymous" | "player" | "tv" | "admin";
  playerId?: string;
  lastView?: string;
  lastBodySlot?: string;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface TransportOptions {
  publicUrl: string;
  adminPin: string;
  tokens: Tokens;
  clock: () => number;
}

const GROUP_ROOMS = ["alive", "impostors", "ghosts"] as const;
const CODE_MAX_FAILURES = 5;
const CODE_LOCK_MS = 30_000;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function badRequest(message = "Requête invalide"): GameError {
  return { code: "BAD_REQUEST", message };
}

export class Transport {
  readonly io: GameIo;
  private readonly adminAuth: AdminAuth;
  private readonly bodyTimer: ReturnType<typeof setInterval>;
  private readonly codeAttempts = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    httpServer: HttpServer,
    private readonly runtime: GameRuntime,
    private readonly opts: TransportOptions,
  ) {
    this.io = new Server(httpServer, { serveClient: false, pingInterval: 10_000, pingTimeout: 8_000 });
    this.adminAuth = new AdminAuth(opts.adminPin, opts.clock);
    this.io.on("connection", (socket) => this.onConnection(socket));
    runtime.onResult((result, command, previous) => this.onResult(result, command, previous));
    this.bodyTimer = setInterval(() => this.pushBodyQrs(), 1000);
  }

  get joinUrl(): string {
    return `${this.opts.publicUrl}/`;
  }

  emergencyUrl(state: GameState = this.runtime.state): string {
    return `${this.opts.publicUrl}/e/${this.opts.tokens.stationToken(state.gameId)}`;
  }

  practiceUrl(state: GameState = this.runtime.state): string {
    return `${this.opts.publicUrl}/t/${this.opts.tokens.practiceToken(state.gameId)}`;
  }

  close(): void {
    clearInterval(this.bodyTimer);
    this.io.close();
  }

  // -------------------------------------------------------------------------
  // Connection & authentication
  // -------------------------------------------------------------------------

  private onConnection(socket: GameSocket): void {
    const auth = isObject(socket.handshake.auth) ? socket.handshake.auth : {};
    socket.data = { kind: "anonymous" };

    if (auth.adminToken !== undefined && this.opts.tokens.verifyAdmin(auth.adminToken, this.opts.adminPin)) {
      this.becomeAdmin(socket);
    } else if (auth.tv === true) {
      socket.data.kind = "tv";
      void socket.join("tv");
    } else if (typeof auth.sessionToken === "string") {
      const player = Object.values(this.runtime.state.players).find((p) => p.sessionToken === auth.sessionToken);
      if (player) this.becomePlayer(socket, player.id);
    }

    socket.on("clock:sync", (ack) => typeof ack === "function" && ack(this.opts.clock()));
    socket.on("state:request", () => this.sendView(socket, true));
    socket.on("admin:auth", (payload, ack) => this.onAdminAuth(socket, payload, ack));
    socket.on("lobby:join", (payload, ack) => this.onJoin(socket, payload, ack));
    socket.on("player:reportCode", (payload, ack) => this.onReportCode(socket, payload, ack));

    for (const name of PLAYER_EVENTS) {
      if (name === "lobby:join") continue;
      socket.on(name, (payload: unknown, ack?: AckFn) => {
        const playerId = socket.data.playerId;
        if (socket.data.kind !== "player" || !playerId) return this.reply(socket, ack, { code: "NOT_AUTHENTICATED", message: "Session inconnue" });
        const command = this.playerCommand(name, playerId, payload);
        if (!command) return this.reply(socket, ack, badRequest());
        this.reply(socket, ack, this.runtime.dispatch(command).error);
      });
    }

    for (const name of ADMIN_EVENTS) {
      socket.on(name, (payload: unknown, ack?: AckFn) => {
        if (socket.data.kind !== "admin") return this.reply(socket, ack, { code: "NOT_AUTHENTICATED", message: "Accès MJ requis" });
        const command = this.adminCommand(name, payload);
        if (!command) return this.reply(socket, ack, badRequest());
        this.reply(socket, ack, this.runtime.dispatch(command).error);
      });
    }

    socket.on("disconnect", () => {
      const playerId = socket.data.playerId;
      if (socket.data.kind === "player" && playerId && !this.hasPlayerSocket(playerId, socket.id)) {
        this.runtime.dispatch({ type: "system:connection", playerId, connected: false });
      }
    });

    this.sendView(socket, true);
  }

  private becomePlayer(socket: GameSocket, playerId: string): void {
    socket.data.kind = "player";
    socket.data.playerId = playerId;
    socket.data.lastBodySlot = undefined;
    void socket.join(`player:${playerId}`);
    this.updateGroupRooms(socket);
    this.runtime.dispatch({ type: "system:connection", playerId, connected: true });
    this.pushBodyQr(socket);
  }

  private becomeAdmin(socket: GameSocket): void {
    socket.data.kind = "admin";
    socket.data.playerId = undefined;
    void socket.join("admin");
  }

  private onAdminAuth(socket: GameSocket, payload: unknown, ack?: AckFn): void {
    const pin = isObject(payload) ? payload.pin : undefined;
    const outcome = this.adminAuth.check(socket.handshake.address, pin);
    if (outcome === "locked") return this.reply(socket, ack, { code: "RATE_LIMITED", message: "Trop d'essais, réessayez dans une minute" });
    if (outcome === "bad") return this.reply(socket, ack, { code: "BAD_PIN", message: "Code incorrect" });
    this.becomeAdmin(socket);
    ack?.({ ok: true, data: { adminToken: this.opts.tokens.adminToken(this.opts.adminPin) } });
    this.sendView(socket, true);
  }

  private onJoin(socket: GameSocket, payload: unknown, ack?: AckFn): void {
    if (socket.data.kind !== "anonymous") return this.reply(socket, ack, { code: "NOT_ALLOWED", message: "Déjà inscrit" });
    if (!isObject(payload) || typeof payload.name !== "string" || typeof payload.color !== "string") {
      return this.reply(socket, ack, badRequest());
    }
    const playerId = newPlayerId();
    const sessionToken = newSessionToken();
    const result = this.runtime.dispatch({ type: "lobby:join", playerId, sessionToken, name: payload.name, color: payload.color });
    if (result.error) return this.reply(socket, ack, result.error);
    ack?.({ ok: true, data: { token: sessionToken } });
    socket.emit("player:session", { token: sessionToken });
    this.becomePlayer(socket, playerId);
    this.sendView(socket);
  }

  /** Report by typing the body's short code; wrong guesses are limited to stop brute force. */
  private onReportCode(socket: GameSocket, payload: unknown, ack?: AckFn): void {
    const playerId = socket.data.playerId;
    if (socket.data.kind !== "player" || !playerId) return this.reply(socket, ack, { code: "NOT_AUTHENTICATED", message: "Session inconnue" });
    const now = this.opts.clock();
    const attempts = this.codeAttempts.get(playerId);
    if (attempts && attempts.lockedUntil > now) {
      return this.reply(socket, ack, { code: "RATE_LIMITED", message: `Trop d'essais, réessaie dans ${Math.ceil((attempts.lockedUntil - now) / 1000)} s` });
    }
    const code = isObject(payload) && typeof payload.code === "string" ? payload.code.replace(/\D/g, "") : "";
    const s = this.runtime.state;
    if (s.phase !== "PLAYING") {
      // The engine produces the right message (meeting in progress, game not started…).
      return this.reply(socket, ack, this.runtime.dispatch({ type: "player:reportBody", playerId, bodyOfId: "" }).error);
    }
    const bodies = Object.values(s.players).filter((p) => p.status === "BODY").map((p) => p.id);
    const matches = code.length === 4 ? this.opts.tokens.matchBodyCode(code, s.gameId, bodies, now, s.params.bodyQrRotationSeconds) : [];
    if (matches.length !== 1) {
      const count = (attempts && attempts.lockedUntil === 0 ? attempts.count : 0) + 1;
      this.codeAttempts.set(playerId, { count, lockedUntil: count >= CODE_MAX_FAILURES ? now + CODE_LOCK_MS : 0 });
      return this.reply(socket, ack, { code: "INVALID_TOKEN", message: "Code invalide ou expiré : relis le code sous le QR" });
    }
    this.codeAttempts.delete(playerId);
    this.reply(socket, ack, this.runtime.dispatch({ type: "player:reportBody", playerId, bodyOfId: matches[0]! }).error);
  }

  private reply(socket: GameSocket, ack: AckFn | undefined, error: GameError | undefined): void {
    if (error) {
      socket.emit("error", error);
      if (typeof ack === "function") ack({ ok: false, error });
    } else if (typeof ack === "function") {
      ack({ ok: true });
    }
  }

  // -------------------------------------------------------------------------
  // Payload validation → engine commands
  // -------------------------------------------------------------------------

  private playerCommand(name: ClientEventName, playerId: string, payload: unknown): Command | null {
    const p = isObject(payload) ? payload : {};
    switch (name) {
      case "lobby:changeColor":
        return typeof p.color === "string" ? { type: name, playerId, color: p.color } : null;
      case "lobby:ready":
      case "player:declareDeath":
      case "player:arrived":
        return { type: name, playerId };
      case "player:vote":
        return typeof p.targetId === "string" ? { type: name, playerId, targetId: p.targetId } : null;
      default:
        return null;
    }
  }

  private adminCommand(name: ClientEventName, payload: unknown): Command | null {
    const p = isObject(payload) ? payload : {};
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    switch (name) {
      case "admin:updateParams":
        return isObject(p.params) ? { type: name, params: p.params } : null;
      case "admin:kick":
      case "admin:declareDeath":
      case "admin:revive": {
        const playerId = str(p.playerId);
        return playerId ? { type: name, playerId } : null;
      }
      case "admin:rename": {
        const playerId = str(p.playerId);
        const newName = str(p.name);
        return playerId && newName !== undefined ? { type: name, playerId, name: newName } : null;
      }
      case "admin:start":
        return { type: name, force: p.force === true };
      case "admin:callMeeting":
        return p.bodyOfId === undefined ? { type: name } : str(p.bodyOfId) ? { type: name, bodyOfId: str(p.bodyOfId) } : null;
      case "admin:endGame":
        return p.winner === "crew" || p.winner === "impostors" ? { type: name, winner: p.winner } : null;
      case "admin:advancePhase":
      case "admin:backToLobby":
        return { type: name };
      default:
        return null;
    }
  }

  // -------------------------------------------------------------------------
  // Fan-out after every accepted command
  // -------------------------------------------------------------------------

  private hasPlayerSocket(playerId: string, exceptSocketId: string): boolean {
    for (const s of this.io.of("/").sockets.values()) {
      if (s.id !== exceptSocketId && s.data.playerId === playerId) return true;
    }
    return false;
  }

  private onResult(result: ReduceResult, _command: Command, _previous: GameState): void {
    const all = [...this.io.of("/").sockets.values()];
    for (const socket of all) this.updateGroupRooms(socket);
    for (const event of result.events) this.route(event);

    // Sessions of removed (kicked) players become anonymous.
    for (const socket of all) {
      const id = socket.data.playerId;
      if (socket.data.kind === "player" && id && !result.state.players[id]) {
        void socket.leave(`player:${id}`);
        socket.data = { kind: "anonymous" };
        this.updateGroupRooms(socket);
      }
    }
    for (const socket of all) this.sendView(socket);
    this.pushBodyQrs();
  }

  private route(event: OutboundEvent): void {
    // Engine events are typed as a union; the untyped emitter avoids a per-event switch.
    type Emitter = { emit: (name: string, payload: unknown) => unknown };
    const target =
      "player" in event.to
        ? this.io.to(`player:${event.to.player}`)
        : event.to.group === "all"
          ? this.io
          : this.io.to(event.to.group);
    (target as unknown as Emitter).emit(event.name, event.payload);
  }

  /** Group rooms are recomputed on every status change; roles only flow through `impostors`. */
  private updateGroupRooms(socket: GameSocket): void {
    const s = this.runtime.state;
    const p = socket.data.kind === "player" && socket.data.playerId ? s.players[socket.data.playerId] : undefined;
    const wanted = new Set<string>();
    if (p) {
      if (isAlive(p)) wanted.add("alive");
      if (p.status === "GHOST") wanted.add("ghosts");
      if (s.phase !== "LOBBY" && p.role === "impostor" && isAlive(p)) wanted.add("impostors");
    }
    for (const room of GROUP_ROOMS) {
      if (wanted.has(room) && !socket.rooms.has(room)) void socket.join(room);
      if (!wanted.has(room) && socket.rooms.has(room)) void socket.leave(room);
    }
  }

  viewFor(socket: GameSocket): ClientView {
    const s = this.runtime.state;
    switch (socket.data.kind) {
      case "admin":
        return adminView(s, this.joinUrl, this.emergencyUrl(s));
      case "tv":
        return tvView(s, this.joinUrl, this.practiceUrl(s));
      case "player":
        return playerView(s, socket.data.playerId!);
      default:
        return anonymousView(s);
    }
  }

  /** Sends `state:sync` only when this client's view actually changed. */
  private sendView(socket: GameSocket, force = false): void {
    const view = this.viewFor(socket);
    const json = JSON.stringify(view);
    if (!force && json === socket.data.lastView) return;
    socket.data.lastView = json;
    socket.emit("state:sync", view);
  }

  // -------------------------------------------------------------------------
  // Rotating body QR codes
  // -------------------------------------------------------------------------

  private pushBodyQrs(): void {
    if (this.runtime.state.phase !== "PLAYING") return;
    for (const socket of this.io.of("/").sockets.values()) this.pushBodyQr(socket);
  }

  private pushBodyQr(socket: GameSocket): void {
    const s = this.runtime.state;
    const id = socket.data.playerId;
    if (s.phase !== "PLAYING" || socket.data.kind !== "player" || !id || s.players[id]?.status !== "BODY") return;
    const rotation = s.params.bodyQrRotationSeconds;
    const slot = Tokens.bodySlot(this.opts.clock(), rotation);
    const key = `${s.gameId}:${slot}`;
    if (socket.data.lastBodySlot === key) return;
    socket.data.lastBodySlot = key;
    const token = this.opts.tokens.bodyToken(s.gameId, id, slot);
    socket.emit("body:qr", {
      token,
      url: `${this.opts.publicUrl}/r/${token}`,
      code: this.opts.tokens.bodyCode(s.gameId, id, slot),
      expiresAt: (slot + 1) * rotation * 1000,
    });
  }
}
