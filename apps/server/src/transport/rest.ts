import { ADMIN_COOKIE, SESSION_COOKIE, SESSION_HEADER, type GameError } from "@among-us/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parseCookies } from "../auth";
import type { Command } from "../engine";
import type { GameRuntime } from "../game";
import type { Tokens } from "../tokens";
import type { PrintableStation } from "./socket";
import { emergencyPage, stationsPage } from "./stationsPrint";

export interface RestOptions {
  runtime: GameRuntime;
  tokens: Tokens;
  adminPin: string;
  clock: () => number;
  emergencyUrl: () => string;
  stations: () => PrintableStation[];
}

const STATUS: Partial<Record<GameError["code"], number>> = {
  NOT_AUTHENTICATED: 401,
  INVALID_TOKEN: 400,
  BAD_REQUEST: 400,
  UNKNOWN_PLAYER: 401,
};

function sendError(reply: FastifyReply, error: GameError) {
  return reply.code(STATUS[error.code] ?? 409).send({ ok: false, error });
}

function sessionPlayerId(req: FastifyRequest, runtime: GameRuntime): string | undefined {
  const header = req.headers[SESSION_HEADER];
  const token = (typeof header === "string" ? header : undefined) ?? parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return undefined;
  return Object.values(runtime.state.players).find((p) => p.sessionToken === token)?.id;
}

function tokenOf(body: unknown): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>).token : undefined;
}

/** Routes hit from pages opened by the phone's native camera (QR scans). */
export function registerRest(app: FastifyInstance, opts: RestOptions): void {
  const { runtime, tokens } = opts;

  const scanRoute = (build: (playerId: string, body: unknown) => Command | GameError) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const playerId = sessionPlayerId(req, runtime);
      if (!playerId) {
        return sendError(reply, {
          code: "NOT_AUTHENTICATED",
          message: "Ouvrez ce lien dans le navigateur avec lequel vous avez rejoint la partie",
        });
      }
      const command = build(playerId, req.body);
      if (!("type" in command)) return sendError(reply, command);
      const result = runtime.dispatch(command);
      if (result.error) return sendError(reply, result.error);
      return { ok: true };
    };

  app.post(
    "/api/report",
    scanRoute((playerId, body) => {
      const s = runtime.state;
      const decoded = tokens.verifyBody(tokenOf(body), opts.clock(), s.params.bodyQrRotationSeconds);
      if (!decoded || decoded.gameId !== s.gameId) return { code: "INVALID_TOKEN", message: "QR code expiré ou invalide : scannez à nouveau" };
      return { type: "player:reportBody", playerId, bodyOfId: decoded.playerId };
    }),
  );

  app.post(
    "/api/emergency",
    scanRoute((playerId, body) => {
      const decoded = tokens.verifyEmergency(tokenOf(body));
      if (!decoded || decoded.printKey !== runtime.state.printKey) {
        return { code: "INVALID_TOKEN", message: "QR code d'urgence périmé : les QR ont été renouvelés, demandez au MJ de le réimprimer" };
      }
      return { type: "player:emergency", playerId };
    }),
  );

  app.post(
    "/api/practice",
    scanRoute((playerId, body) => {
      const decoded = tokens.verifyPractice(tokenOf(body));
      if (!decoded || decoded.gameId !== runtime.state.gameId) {
        return { code: "INVALID_TOKEN", message: "QR d'essai périmé : scannez celui affiché sur la TV" };
      }
      return { type: "player:practiceScan", playerId };
    }),
  );

  const isAdmin = (req: FastifyRequest) => tokens.verifyAdmin(parseCookies(req.headers.cookie)[ADMIN_COOKIE], opts.adminPin);
  const denied = (reply: FastifyReply) => reply.code(401).type("text/html").send("<p>Accès réservé au maître du jeu.</p>");

  app.get("/api/print/emergency", async (req, reply) => {
    if (!isAdmin(req)) return denied(reply);
    return reply.type("text/html").send(emergencyPage(opts.emergencyUrl()));
  });

  app.get("/api/print/stations", async (req, reply) => {
    if (!isAdmin(req)) return denied(reply);
    return reply.type("text/html").send(stationsPage(opts.stations()));
  });
}
