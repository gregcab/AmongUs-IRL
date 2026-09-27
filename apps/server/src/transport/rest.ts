import { ADMIN_COOKIE, SESSION_COOKIE, SESSION_HEADER, type GameError } from "@among-us/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { parseCookies } from "../auth";
import type { Command } from "../engine";
import type { GameRuntime } from "../game";
import type { Tokens } from "../tokens";

export interface RestOptions {
  runtime: GameRuntime;
  tokens: Tokens;
  adminPin: string;
  clock: () => number;
  emergencyUrl: () => string;
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
      const decoded = tokens.verifyStation(tokenOf(body));
      if (!decoded || decoded.gameId !== runtime.state.gameId) {
        return { code: "INVALID_TOKEN", message: "QR code d'urgence périmé : demandez au MJ de le réimprimer" };
      }
      return { type: "player:emergency", playerId };
    }),
  );

  app.get("/api/print/emergency", async (req, reply) => {
    if (!tokens.verifyAdmin(parseCookies(req.headers.cookie)[ADMIN_COOKIE], opts.adminPin)) {
      return reply.code(401).type("text/html").send("<p>Accès réservé au maître du jeu.</p>");
    }
    const url = opts.emergencyUrl();
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
    return reply.type("text/html").send(printPage(svg));
  });
}

function printPage(svg: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Station d'urgence</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: system-ui, sans-serif; text-align: center; color: #000; background: #fff; margin: 0; }
  h1 { font-size: 34pt; margin: 10mm 0 4mm; letter-spacing: .02em; }
  p { font-size: 15pt; margin: 2mm 0; }
  .qr { width: 150mm; height: 150mm; margin: 8mm auto; border: 3mm solid #d71e1e; padding: 4mm; }
  .qr svg { width: 100%; height: 100%; }
  button { font-size: 14pt; padding: 3mm 8mm; margin-top: 6mm; }
  @media print { button { display: none; } }
</style></head>
<body>
  <h1>RÉUNION D'URGENCE</h1>
  <p>Scannez avec l'appareil photo du téléphone qui vous sert à jouer.</p>
  <div class="qr">${svg}</div>
  <p>Valable uniquement pour la partie en cours.</p>
  <button onclick="window.print()">Imprimer</button>
</body></html>`;
}
