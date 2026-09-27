// Tasks done on the phone at printed stations (catalog: docs/propositions-taches.html,
// "Téléphone" filter). Every player draws a list at game start; impostors get a fake one
// that looks and plays the same but never moves the task bar.

export const TASK_TYPES = ["card", "data", "fuel", "wires", "safe", "distributor", "simon", "antenna", "doubleKey", "shield"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export type TaskCategory = "common" | "long" | "short";

export const TASK_CATEGORY_LABEL: Record<TaskCategory, string> = {
  common: "Communes",
  long: "Longues",
  short: "Courtes",
};

export interface TaskDef {
  type: TaskType;
  name: string;
  category: TaskCategory;
  /** Station ids of each step, in order; a step may be done at any of its stations. */
  steps: readonly (readonly string[])[];
  /** Players needed at the same time (cooperative tasks); anybody may help. */
  coop?: number;
  /** One-line instruction shown at the station. */
  help: string;
}

export const TASK_DEFS = [
  { type: "card", name: "Carte d'accès", category: "common", steps: [["card"]], help: "Glisse la carte d'un geste régulier : ni trop vite, ni trop lentement." },
  {
    type: "data",
    name: "Télécharger puis envoyer les données",
    category: "long",
    steps: [["data-download"], ["data-upload"]],
    help: "Télécharge à la première station, puis envoie à la seconde. Garde l'écran allumé.",
  },
  { type: "fuel", name: "Remplir le moteur", category: "long", steps: [["fuel-tank"], ["engine"]], help: "Maintiens le doigt pour remplir le bidon, puis pour le vider dans le moteur." },
  { type: "wires", name: "Brancher les câbles", category: "short", steps: [["wires"]], help: "Relie chaque fil à la prise de sa couleur en glissant le doigt." },
  { type: "safe", name: "Code du coffre", category: "short", steps: [["safe"]], help: "Mémorise les 5 chiffres, puis retape-les." },
  { type: "distributor", name: "Calibrer le distributeur", category: "short", steps: [["distributor"]], help: "Arrête chaque jauge dans la zone verte." },
  { type: "simon", name: "Réacteur (Simon)", category: "short", steps: [["simon"]], help: "Reproduis la séquence de couleurs, jusqu'à 5." },
  { type: "antenna", name: "Aligner l'antenne", category: "short", steps: [["antenna"]], help: "Aligne la flèche sur la cible avec le curseur, puis tiens-la une seconde." },
  { type: "doubleKey", name: "Double clé", category: "short", steps: [["key-a", "key-b"]], coop: 2, help: "Deux joueurs tournent les clés A et B à moins de 5 s d'écart." },
  { type: "shield", name: "Bouclier du vaisseau", category: "short", steps: [["shield"]], coop: 3, help: "Trois joueurs maintiennent le doigt sur leur écran ensemble pendant 10 s." },
] as const satisfies readonly TaskDef[];

const DEFS = new Map<string, TaskDef>(TASK_DEFS.map((d) => [d.type, d]));

export function taskDef(type: TaskType): TaskDef {
  return DEFS.get(type)!;
}

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === "string" && DEFS.has(value);
}

/** Two key turns count together when they are at most this far apart. */
export const KEY_WINDOW_MS = 5_000;
/** The shield charges while enough players hold the station for this long. */
export const SHIELD_CHARGE_MS = 10_000;
/** Durations of the timed steps, identical for everybody. */
export const DATA_TRANSFER_MS = 20_000;
export const FUEL_HOLD_MS = 10_000;

export type TaskBarUpdates = "always" | "meetings" | "never";

export const TASK_BAR_LABEL: Record<TaskBarUpdates, string> = {
  always: "Toujours",
  meetings: "Pendant les réunions",
  never: "Jamais",
};
