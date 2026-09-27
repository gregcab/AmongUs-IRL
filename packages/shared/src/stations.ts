import type { GameParams } from "./params";

// A station is a physical spot with a printed QR code (`/s/:token`) where players repair
// sabotages or, later, do their tasks. Tokens are bound to the game and change with it.

export const SABOTAGE_KINDS = ["reactor", "oxygen", "lights"] as const;
export type SabotageKind = (typeof SABOTAGE_KINDS)[number];

/** Critical sabotages make the impostors win when their countdown runs out. */
export const CRITICAL_SABOTAGES: readonly SabotageKind[] = ["reactor", "oxygen"];

export const SABOTAGE_LABEL: Record<SabotageKind, string> = {
  reactor: "Réacteur",
  oxygen: "Oxygène",
  lights: "Lumières",
};

export interface StationDef {
  id: string;
  /** Default name, editable by the game master. */
  name: string;
  /** What players do there, shown to the game master. */
  purpose: string;
  /** Sabotage repaired at this station, if any. */
  sabotage?: SabotageKind;
}

export const STATION_DEFS = [
  { id: "reactor-a", name: "Réacteur gauche", purpose: "Réacteur : maintenir le doigt en même temps que la station Réacteur droit", sabotage: "reactor" },
  { id: "reactor-b", name: "Réacteur droit", purpose: "Réacteur : maintenir le doigt en même temps que la station Réacteur gauche", sabotage: "reactor" },
  { id: "o2-a", name: "O2 filtre", purpose: "Oxygène : taper le code lu à la station Admin", sabotage: "oxygen" },
  { id: "o2-b", name: "O2 réserve", purpose: "Oxygène : taper le code lu à la station Admin", sabotage: "oxygen" },
  { id: "admin", name: "Admin", purpose: "Oxygène : affiche les deux codes des stations O2", sabotage: "oxygen" },
  { id: "electrical", name: "Électricité", purpose: "Lumières : remettre tous les interrupteurs", sabotage: "lights" },
] as const satisfies readonly StationDef[];

export type StationId = (typeof STATION_DEFS)[number]["id"];

export const STATION_IDS: readonly StationId[] = STATION_DEFS.map((d) => d.id);

const DEFS = new Map<string, StationDef>(STATION_DEFS.map((d) => [d.id, d]));

export function isStationId(id: unknown): id is StationId {
  return typeof id === "string" && DEFS.has(id);
}

export function stationDef(id: StationId): StationDef {
  return DEFS.get(id)!;
}

/** Stations of each sabotage, in the order they are shown. */
export const SABOTAGE_STATIONS: Record<SabotageKind, readonly StationId[]> = {
  reactor: ["reactor-a", "reactor-b"],
  oxygen: ["o2-a", "o2-b", "admin"],
  lights: ["electrical"],
};

/** The two O2 stations where a code must be typed (codes are read at `admin`). */
export const OXYGEN_CODE_STATIONS: readonly StationId[] = ["o2-a", "o2-b"];

/** Number of switches of the lights mini-game. */
export const LIGHT_SWITCHES = 5;

/** Game-master labels for a station; empty fields fall back to the defaults. */
export interface StationSetup {
  name: string;
  location: string;
}

/** Stations used by the current settings, i.e. the ones to print. */
export function stationEnabled(params: GameParams, id: StationId): boolean {
  const kind = stationDef(id).sabotage;
  return kind !== undefined && params.enabledSabotages.includes(kind);
}

export const STATION_NAME_MAX = 30;
export const STATION_LOCATION_MAX = 40;
