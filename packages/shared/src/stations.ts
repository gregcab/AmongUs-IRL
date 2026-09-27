import type { GameParams } from "./params";
import { TASK_DEFS, type TaskType } from "./tasks";

// A station is a physical spot with a printed QR code (`/s/:token`) where players repair
// sabotages or do their tasks. Tokens are bound to the game and change with it.

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
  /** Task done at this station, if any. */
  task?: TaskType;
}

export const STATION_DEFS = [
  { id: "reactor-a", name: "Réacteur gauche", purpose: "Réacteur : maintenir le doigt en même temps que la station Réacteur droit", sabotage: "reactor" },
  { id: "reactor-b", name: "Réacteur droit", purpose: "Réacteur : maintenir le doigt en même temps que la station Réacteur gauche", sabotage: "reactor" },
  { id: "o2-a", name: "O2 filtre", purpose: "Oxygène : taper le code lu à la station Admin", sabotage: "oxygen" },
  { id: "o2-b", name: "O2 réserve", purpose: "Oxygène : taper le code lu à la station Admin", sabotage: "oxygen" },
  { id: "admin", name: "Admin", purpose: "Oxygène : affiche les deux codes des stations O2", sabotage: "oxygen" },
  { id: "electrical", name: "Électricité", purpose: "Lumières : remettre tous les interrupteurs", sabotage: "lights" },
  { id: "card", name: "Lecteur de carte", purpose: "Tâche commune : glisser la carte d'accès", task: "card" },
  { id: "data-download", name: "Données (téléchargement)", purpose: "Tâche longue, étape 1 : télécharger (20 s)", task: "data" },
  { id: "data-upload", name: "Données (envoi)", purpose: "Tâche longue, étape 2 : envoyer (20 s) ; loin de l'étape 1", task: "data" },
  { id: "fuel-tank", name: "Réserve de carburant", purpose: "Tâche longue, étape 1 : remplir le bidon (10 s)", task: "fuel" },
  { id: "engine", name: "Moteur", purpose: "Tâche longue, étape 2 : vider le bidon (10 s) ; loin de l'étape 1", task: "fuel" },
  { id: "wires", name: "Câblage", purpose: "Tâche courte : brancher les câbles", task: "wires" },
  { id: "safe", name: "Coffre-fort", purpose: "Tâche courte : code du coffre", task: "safe" },
  { id: "distributor", name: "Distributeur", purpose: "Tâche courte : calibrer le distributeur", task: "distributor" },
  { id: "simon", name: "Démarreur du réacteur", purpose: "Tâche courte : séquence de couleurs (Simon)", task: "simon" },
  { id: "antenna", name: "Antenne", purpose: "Tâche courte : aligner l'antenne", task: "antenna" },
  { id: "key-a", name: "Clé A", purpose: "Tâche à deux : tourner en même temps que la Clé B (placer loin l'une de l'autre)", task: "doubleKey" },
  { id: "key-b", name: "Clé B", purpose: "Tâche à deux : tourner en même temps que la Clé A", task: "doubleKey" },
  { id: "shield", name: "Boucliers", purpose: "Tâche à trois : maintenir le doigt ensemble 10 s", task: "shield" },
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
  const { sabotage, task } = stationDef(id);
  if (sabotage) return params.enabledSabotages.includes(sabotage);
  return task !== undefined && params.enabledTasks.includes(task);
}

/** Stations of each task step, typed. */
export function taskStations(type: TaskType, step: number): StationId[] {
  const def = TASK_DEFS.find((d) => d.type === type)!;
  return [...(def.steps[step] ?? [])] as StationId[];
}

export const STATION_NAME_MAX = 30;
export const STATION_LOCATION_MAX = 40;
