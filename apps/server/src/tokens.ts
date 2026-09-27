import { createHmac, timingSafeEqual } from "node:crypto";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function unb64(text: string): string | null {
  try {
    return Buffer.from(text, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** HMAC-SHA256 signed tokens encoded in QR codes, plus the stateless admin session token. */
export class Tokens {
  constructor(private readonly secret: string) {}

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  private seal(payload: string): string {
    return `${b64(payload)}.${this.sign(payload)}`;
  }

  /** Returns the payload if the signature is valid. */
  private open(token: unknown): string | null {
    if (typeof token !== "string" || token.length > 512) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const payload = unb64(token.slice(0, dot));
    if (payload === null) return null;
    return safeEqual(token.slice(dot + 1), this.sign(payload)) ? payload : null;
  }

  static bodySlot(now: number, rotationSeconds: number): number {
    return Math.floor(now / (rotationSeconds * 1000));
  }

  bodyToken(gameId: string, playerId: string, slot: number): string {
    return this.seal(`B|${gameId}|${playerId}|${slot}`);
  }

  /** Accepts the current rotation slot and the previous one. */
  verifyBody(token: unknown, now: number, rotationSeconds: number): { gameId: string; playerId: string } | null {
    const payload = this.open(token);
    const parts = payload?.split("|");
    if (!parts || parts.length !== 4 || parts[0] !== "B") return null;
    const slot = Number(parts[3]);
    const current = Tokens.bodySlot(now, rotationSeconds);
    if (!Number.isInteger(slot) || (slot !== current && slot !== current - 1)) return null;
    return { gameId: parts[1]!, playerId: parts[2]! };
  }

  /** 4-digit code rotating with the body QR, for typing instead of scanning. */
  bodyCode(gameId: string, playerId: string, slot: number): string {
    const digest = createHmac("sha256", this.secret).update(`C|${gameId}|${playerId}|${slot}`).digest();
    return String(digest.readUInt32BE(0) % 10000).padStart(4, "0");
  }

  /** Bodies whose code matches for the current or the previous rotation slot. */
  matchBodyCode(code: string, gameId: string, candidates: string[], now: number, rotationSeconds: number): string[] {
    const current = Tokens.bodySlot(now, rotationSeconds);
    return candidates.filter((id) => [current, current - 1].some((slot) => safeEqual(this.bodyCode(gameId, id, slot), code)));
  }

  /** Printed emergency meeting QR, bound to the game. */
  emergencyToken(gameId: string): string {
    return this.seal(`E|${gameId}`);
  }

  verifyEmergency(token: unknown): { gameId: string } | null {
    const parts = this.open(token)?.split("|");
    if (!parts || parts.length !== 2 || parts[0] !== "E") return null;
    return { gameId: parts[1]! };
  }

  /** Printed station QR (`/s/:token`), bound to the game and the station. */
  stationToken(gameId: string, stationId: string): string {
    return this.seal(`S|${gameId}|${stationId}`);
  }

  verifyStation(token: unknown): { gameId: string; stationId: string } | null {
    const parts = this.open(token)?.split("|");
    if (!parts || parts.length !== 3 || parts[0] !== "S") return null;
    return { gameId: parts[1]!, stationId: parts[2]! };
  }

  /**
   * 4-digit codes printed under the station QR codes, typed in the app when the camera opens
   * another browser. Derived from the game, and distinct from one another within a game.
   */
  stationCodes(gameId: string, stationIds: readonly string[]): Map<string, string> {
    const codes = new Map<string, string>();
    const used = new Set<string>();
    for (const id of stationIds) {
      for (let salt = 0; ; salt++) {
        const digest = createHmac("sha256", this.secret).update(`SC|${gameId}|${id}|${salt}`).digest();
        const code = String(digest.readUInt32BE(0) % 10000).padStart(4, "0");
        if (used.has(code)) continue;
        used.add(code);
        codes.set(id, code);
        break;
      }
    }
    return codes;
  }

  /** Lobby scan practice QR shown on the TV, bound to the game. */
  practiceToken(gameId: string): string {
    return this.seal(`P|${gameId}`);
  }

  verifyPractice(token: unknown): { gameId: string } | null {
    const parts = this.open(token)?.split("|");
    if (!parts || parts.length !== 2 || parts[0] !== "P") return null;
    return { gameId: parts[1]! };
  }

  /** Stateless admin session: survives restarts, invalidated by a PIN change. */
  adminToken(pin: string): string {
    return this.sign(`A|${pin}`);
  }

  verifyAdmin(token: unknown, pin: string): boolean {
    return typeof token === "string" && safeEqual(token, this.adminToken(pin));
  }
}
