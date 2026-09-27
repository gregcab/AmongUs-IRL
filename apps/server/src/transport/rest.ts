import { ADMIN_COOKIE, SESSION_COOKIE, SESSION_HEADER, stationDef, type GameError } from "@among-us/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { parseCookies } from "../auth";
import type { Command } from "../engine";
import type { GameRuntime } from "../game";
import type { Tokens } from "../tokens";
import type { PrintableStation } from "./socket";

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
      if (!decoded || decoded.gameId !== runtime.state.gameId) {
        return { code: "INVALID_TOKEN", message: "QR code d'urgence périmé : demandez au MJ de le réimprimer" };
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
    const url = opts.emergencyUrl();
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
    return reply.type("text/html").send(printPage(svg));
  });

  app.get("/api/print/stations", async (req, reply) => {
    if (!isAdmin(req)) return denied(reply);
    const cards = await Promise.all(
      opts.stations().map(async (st) => ({ ...st, svg: await QRCode.toString(st.url, { type: "svg", errorCorrectionLevel: "M", margin: 1 }) })),
    );
    return reply.type("text/html").send(stationsPage(cards));
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function stationsPage(cards: (PrintableStation & { svg: string })[]): string {
  const body =
    cards.length === 0
      ? "<p class=\"empty\">Aucune station à imprimer : activez des sabotages dans les paramètres.</p>"
      : cards
          .map(
            (c) => `<section class="card" data-station="${c.id}">
  <div class="name">${escapeHtml(c.name)}</div>
  ${c.location ? `<div class="loc">${escapeHtml(c.location)}</div>` : ""}
  <div class="qr">${c.svg}</div>
  <div class="code">Code <b>${c.code}</b></div>
  <div class="purpose">${escapeHtml(stationDef(c.id).purpose)}</div>
</section>`,
          )
          .join("\n");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Stations</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: system-ui, sans-serif; color: #000; background: #fff; margin: 0; }
  header { text-align: center; margin: 4mm 0 6mm; }
  header h1 { font-size: 22pt; margin: 0 0 2mm; }
  header p { margin: 0; font-size: 11pt; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .card { border: 1mm solid #000; border-radius: 4mm; padding: 5mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .name { font-size: 20pt; font-weight: 800; }
  .loc { font-size: 12pt; margin-top: 1mm; }
  .qr { width: 62mm; height: 62mm; margin: 4mm auto 2mm; }
  .qr svg { width: 100%; height: 100%; }
  .code { font-size: 13pt; }
  .code b { font-size: 18pt; letter-spacing: .15em; }
  .purpose { font-size: 9pt; color: #333; margin-top: 2mm; }
  .empty { text-align: center; font-size: 14pt; }
  button { font-size: 13pt; padding: 3mm 8mm; margin-top: 3mm; }
  @media print { button { display: none; } }
</style></head>
<body>
  <header>
    <h1>Stations</h1>
    <p>Scannez avec l'appareil photo du téléphone qui vous sert à jouer, ou tapez le code dans le jeu. Valables uniquement pour la partie en cours.</p>
    <button onclick="window.print()">Imprimer</button>
  </header>
  <div class="grid">
${body}
  </div>
</body></html>`;
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
