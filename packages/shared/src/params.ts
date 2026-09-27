import { SABOTAGE_KINDS, type SabotageKind } from "./stations";
import type { GhostMeetingMode } from "./types";

export interface GameParams {
  minPlayers: number;
  impostorCount: number | "auto";
  roleRevealSeconds: number;
  deathDelaySeconds: number;
  killCooldownSeconds: number;
  bodyQrRotationSeconds: number;
  emergencyMeetingsPerPlayer: number;
  emergencyCooldownSeconds: number;
  gatheringTimeoutSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  resumeCountdownSeconds: number;
  ghostMeetingMode: GhostMeetingMode;
  confirmEjects: boolean;
  anonymousVotes: boolean;
  /** Reserved for tasks (out of MVP scope). */
  freezeTasksDuringMeeting: boolean;
  /** Countdown of the critical sabotages (reactor, oxygen). */
  sabotageCriticalSeconds: number;
  /** Cooldown shared by the impostors, restarted after each sabotage and each meeting. */
  sabotageCooldownSeconds: number;
  enabledSabotages: SabotageKind[];
}

export const DEFAULT_PARAMS: GameParams = {
  minPlayers: 4,
  impostorCount: "auto",
  roleRevealSeconds: 15,
  deathDelaySeconds: 10,
  killCooldownSeconds: 45,
  bodyQrRotationSeconds: 10,
  emergencyMeetingsPerPlayer: 1,
  emergencyCooldownSeconds: 30,
  gatheringTimeoutSeconds: 120,
  discussionSeconds: 90,
  votingSeconds: 60,
  resumeCountdownSeconds: 10,
  ghostMeetingMode: "cemetery",
  confirmEjects: true,
  anonymousVotes: false,
  freezeTasksDuringMeeting: true,
  sabotageCriticalSeconds: 60,
  sabotageCooldownSeconds: 90,
  enabledSabotages: [...SABOTAGE_KINDS],
};

type NumericKey = {
  [K in keyof GameParams]: GameParams[K] extends number ? K : never;
}[keyof GameParams];

export const PARAM_BOUNDS: Record<NumericKey, [min: number, max: number]> = {
  minPlayers: [3, 15],
  roleRevealSeconds: [3, 120],
  deathDelaySeconds: [0, 120],
  killCooldownSeconds: [5, 600],
  bodyQrRotationSeconds: [3, 120],
  emergencyMeetingsPerPlayer: [0, 10],
  emergencyCooldownSeconds: [0, 600],
  gatheringTimeoutSeconds: [10, 900],
  discussionSeconds: [10, 900],
  votingSeconds: [10, 600],
  resumeCountdownSeconds: [3, 120],
  sabotageCriticalSeconds: [15, 600],
  sabotageCooldownSeconds: [5, 900],
};

export const MAX_IMPOSTORS = 5;

export type ParamsValidation =
  | { ok: true; params: GameParams }
  | { ok: false; errors: string[] };

/** Merges a partial update into `base` and validates the result. */
export function validateParams(base: GameParams, update: unknown): ParamsValidation {
  if (typeof update !== "object" || update === null || Array.isArray(update)) {
    return { ok: false, errors: ["Paramètres invalides"] };
  }
  const input = update as Record<string, unknown>;
  const next: GameParams = { ...base };
  const errors: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULT_PARAMS)) {
      errors.push(`Paramètre inconnu : ${key}`);
      continue;
    }
    if (key in PARAM_BOUNDS) {
      const [min, max] = PARAM_BOUNDS[key as NumericKey];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        errors.push(`${key} doit être un entier entre ${min} et ${max}`);
        continue;
      }
      (next as unknown as Record<string, unknown>)[key] = value;
      continue;
    }
    switch (key) {
      case "impostorCount":
        if (value === "auto" || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_IMPOSTORS)) {
          next.impostorCount = value;
        } else {
          errors.push(`impostorCount doit valoir "auto" ou un entier entre 1 et ${MAX_IMPOSTORS}`);
        }
        break;
      case "ghostMeetingMode":
        if (value === "cemetery" || value === "spectator") next.ghostMeetingMode = value;
        else errors.push('ghostMeetingMode doit valoir "cemetery" ou "spectator"');
        break;
      case "confirmEjects":
      case "anonymousVotes":
      case "freezeTasksDuringMeeting":
        if (typeof value === "boolean") next[key] = value;
        else errors.push(`${key} doit être un booléen`);
        break;
      case "enabledSabotages": {
        const list = subsetOf(SABOTAGE_KINDS, value);
        if (list) next.enabledSabotages = list;
        else errors.push("enabledSabotages doit être une liste de sabotages connus");
        break;
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, params: next };
}

/** `value` as a duplicate-free list of `allowed` items, in catalog order, or null. */
function subsetOf<T extends string>(allowed: readonly T[], value: unknown): T[] | null {
  if (!Array.isArray(value) || !value.every((v) => allowed.includes(v as T))) return null;
  return allowed.filter((a) => value.includes(a));
}

/** Number of impostors for `playerCount` players, or null if the configuration is invalid. */
export function resolveImpostorCount(setting: GameParams["impostorCount"], playerCount: number): number | null {
  let count: number;
  if (setting === "auto") {
    if (playerCount <= 6) count = 1;
    else if (playerCount <= 9) count = 2;
    else count = 3;
  } else {
    count = setting;
  }
  if (count < 1 || count * 2 >= playerCount) return null;
  return count;
}
