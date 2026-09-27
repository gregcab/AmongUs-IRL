import { createHash, randomBytes } from "node:crypto";
import { safeEqual } from "./tokens";

export function newSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function newPlayerId(): string {
  return randomBytes(9).toString("base64url");
}

const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

/** Admin PIN check with a per-client lockout after repeated failures. */
export class AdminAuth {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly pin: string,
    private readonly clock: () => number = Date.now,
  ) {}

  check(client: string, attempt: unknown): "ok" | "bad" | "locked" {
    const now = this.clock();
    const entry = this.failures.get(client);
    if (entry && entry.lockedUntil > now) return "locked";
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    if (typeof attempt === "string" && safeEqual(hash(attempt), hash(this.pin))) {
      this.failures.delete(client);
      return "ok";
    }
    // An expired lock starts a fresh series of attempts.
    const count = (entry && entry.lockedUntil === 0 ? entry.count : 0) + 1;
    this.failures.set(client, { count, lockedUntil: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
    return "bad";
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}
