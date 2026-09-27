export interface PlayerColor {
  id: string;
  label: string;
  hex: string;
  /** Text color readable on top of `hex`. */
  ink: string;
}

export const PLAYER_COLORS: readonly PlayerColor[] = [
  { id: "red", label: "Rouge", hex: "#D71E1E", ink: "#fff" },
  { id: "blue", label: "Bleu", hex: "#1D3CE0", ink: "#fff" },
  { id: "green", label: "Vert", hex: "#127F2D", ink: "#fff" },
  { id: "pink", label: "Rose", hex: "#EE54BB", ink: "#000" },
  { id: "orange", label: "Orange", hex: "#F07D0D", ink: "#000" },
  { id: "yellow", label: "Jaune", hex: "#F6F657", ink: "#000" },
  { id: "black", label: "Noir", hex: "#3F474E", ink: "#fff" },
  { id: "white", label: "Blanc", hex: "#D7E1F1", ink: "#000" },
  { id: "purple", label: "Violet", hex: "#6B2FBC", ink: "#fff" },
  { id: "brown", label: "Marron", hex: "#71491E", ink: "#fff" },
  { id: "cyan", label: "Cyan", hex: "#38E2DD", ink: "#000" },
  { id: "lime", label: "Citron vert", hex: "#50EF39", ink: "#000" },
  { id: "maroon", label: "Bordeaux", hex: "#6B2B3C", ink: "#fff" },
  { id: "gray", label: "Gris", hex: "#8394A4", ink: "#000" },
  { id: "tan", label: "Beige", hex: "#C9A77C", ink: "#000" },
];

export const MAX_PLAYERS = PLAYER_COLORS.length;

const BY_ID = new Map(PLAYER_COLORS.map((c) => [c.id, c]));

export function isValidColor(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

export function colorOf(id: string): PlayerColor {
  return BY_ID.get(id) ?? { id, label: id, hex: "#888888", ink: "#000" };
}
