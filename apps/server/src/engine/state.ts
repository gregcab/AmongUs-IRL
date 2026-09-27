import { DEFAULT_PARAMS, type GameParams, type GameState, type Player } from "@among-us/shared";

export function createInitialState(gameId: string, params: GameParams = DEFAULT_PARAMS, timeScale = 1): GameState {
  return {
    gameId,
    phase: "LOBBY",
    params: { ...params },
    players: {},
    meetingHistory: [],
    kills: [],
    timeline: [],
    timeScale,
    log: [],
  };
}

/** DYING players still count as alive for everyone else and for win conditions. */
export function isAlive(p: Player): boolean {
  return p.status === "ALIVE" || p.status === "DYING";
}

export function playersInOrder(s: GameState): Player[] {
  return Object.values(s.players).sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

/** Identifies the current timed phase; a phase-end tick carrying another key is stale. */
export function phaseKey(s: GameState): string {
  return `${s.phase}|${s.meeting?.id ?? ""}|${s.meeting?.subPhase ?? ""}`;
}

export function durationMs(s: GameState, seconds: number): number {
  return Math.round(seconds * 1000 * s.timeScale);
}

function isForbiddenChar(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

/** Trimmed, whitespace-collapsed name, or null if invalid (1 to 16 characters). */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  const length = [...name].length;
  if (length < 1 || length > 16 || [...name].some((ch) => isForbiddenChar(ch.codePointAt(0)!))) return null;
  return name;
}

export function nameKey(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("fr");
}
