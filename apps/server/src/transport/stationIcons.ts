import type { StationId } from "@among-us/shared";

// Flat colourful pictograms (64×64) printed next to the station QR codes: thick dark outline, flat
// fills with a shade and a highlight, in the spirit of the game. The accent colour of the station
// (the one of its card and QR code) paints the main part; metal, glass and signal colours are shared.

const INK = "#1b1f2a";
const METAL = "#9aa3b2";
const METAL_D = "#6b7385";
const METAL_L = "#d5dae3";
const GLASS = "#bae6fd";
const YEL = "#facc15";
const RED = "#ef4444";
const GREEN = "#22c55e";
const BLUE = "#3b82f6";
const WHITE = "#ffffff";

/** Outline attributes shared by every icon; the QR badge wraps the icon body in a `<g>` carrying them. */
export const ICON_OUTLINE = `stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"`;

/** Mixes `hex` with `other` (`t` = share of `other`, 0..1). */
function mix(hex: string, other: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(hex, i) * (1 - t) + ch(other, i) * t).toString(16).padStart(2, "0"));
  return `#${out.join("")}`;
}

const svg = (body: string) => `<svg class="icon" viewBox="0 0 64 64" fill="none" ${ICON_OUTLINE} aria-hidden="true">${body}</svg>`;

const rect = (x: number, y: number, w: number, h: number, fill: string, r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const path = (d: string, fill = "none", extra = "") => `<path d="${d}" fill="${fill}" ${extra}/>`;
const circle = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const text = (x: number, y: number, size: number, value: string, fill: string) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="800" text-anchor="middle" font-family="sans-serif" fill="${fill}" stroke="none">${value}</text>`;
/** A highlight stroke (no outline). */
const shine = (d: string, width = 3) => path(d, "none", `stroke="${WHITE}" stroke-opacity=".7" stroke-width="${width}"`);
/** A coloured cable with its outline. */
const wire = (d: string, color: string) => path(d, "none", `stroke="${INK}" stroke-width="7.5"`) + path(d, "none", `stroke="${color}" stroke-width="4"`);

const spark = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${YEL}" stroke="none"/>`;

/** Rocket nozzle with its flame, tilted left or right, plus the G/D badge and an arrow. */
function reactor(side: "left" | "right", a: string): string {
  const f = (x: number) => (side === "left" ? x : 64 - x);
  const tilt = side === "left" ? 10 : -10;
  const arrow = `M${f(3)} 54L${f(11)} 47.5V51.5H${f(18)}V56.5H${f(11)}V60.5z`;
  const engine =
    rect(22, 2, 20, 9, METAL_D, 3) +
    circle(27, 6.5, 1.5, METAL_L) +
    circle(37, 6.5, 1.5, METAL_L) +
    path("M24 11h16l7 14H17z", METAL_L) +
    shine("M26 15l-4 8", 3) +
    rect(13, 24, 38, 5, a, 2.5) +
    path("M16 29q-3 14 11 24l5 10 5-10q14-10 11-24z", RED) +
    path("M22 29q-2 10 7 18l3 5 3-5q9-8 7-18z", a) +
    path("M28 29q-1 7 4 12 5-5 4-12z", YEL);
  return svg(
    `<g transform="rotate(${tilt} 32 10)">${engine}</g>` +
      path(arrow, YEL) +
      circle(f(52), 13, 9.5, YEL) +
      text(f(52), 18, 14, side === "left" ? "G" : "D", INK) +
      spark(f(10), 38, 2) +
      spark(f(56), 50, 2) +
      spark(f(46), 60, 1.6),
  );
}

const key = (letter: string, a: string) =>
  svg(
    rect(26, 26, 32, 9, METAL_L, 3) +
      (letter === "A" ? rect(44, 35, 6, 11, METAL_L, 1.5) + rect(35, 35, 6, 7, METAL_L, 1.5) : rect(50, 35, 6, 12, METAL_L, 1.5) + rect(40, 35, 6, 8, METAL_L, 1.5)) +
      circle(20, 30, 16, a) +
      (letter === "B" ? circle(20, 30, 12, mix(a, "#000000", 0.3)) : "") +
      shine("M11 24a11 11 0 0 1 8-7") +
      text(20, 37, 20, letter, WHITE),
  );

function icons(a: string): Record<StationId, string> {
  const ad = mix(a, "#000000", 0.28);
  const al = mix(a, "#ffffff", 0.55);
  return {
    "reactor-a": reactor("left", a),
    "reactor-b": reactor("right", a),
    "o2-a": svg(
      path("M8 8h48L40 30v20l-16 8V30z", GLASS) +
        path("M15 15h34M20 22h24", "none", `stroke-width="2"`) +
        circle(50, 44, 5, al) +
        circle(56, 56, 4, a) +
        circle(46, 58, 3, al) +
        shine("M13 11h22", 2.5),
    ),
    "o2-b": svg(
      rect(23, 7, 18, 7, METAL_D) +
        rect(26, 12, 12, 10, METAL, 2) +
        rect(16, 20, 32, 40, a, 13) +
        shine("M24 28v20", 4) +
        text(34, 47, 15, "O₂", WHITE) +
        circle(53, 12, 7, WHITE) +
        path("M53 12l3-3", "none", `stroke-width="2"`),
    ),
    admin: svg(
      path("M24 58h16l-3-14H27z", METAL) +
        rect(16, 54, 32, 6, METAL_D) +
        rect(5, 6, 54, 40, METAL_D, 5) +
        rect(10, 11, 44, 30, ad, 3) +
        path("M16 19h18M16 26h26M16 33h14", "none", `stroke="${al}" stroke-width="3"`) +
        circle(46, 33, 4, a),
    ),
    electrical: svg(
      rect(8, 4, 48, 56, METAL, 5) +
        rect(13, 9, 38, 46, METAL_L, 3) +
        rect(17, 13, 8, 26, METAL_D, 4) +
        rect(28, 13, 8, 26, METAL_D, 4) +
        rect(39, 13, 8, 26, METAL_D, 4) +
        rect(15, 15, 12, 10, a, 3) +
        rect(26, 27, 12, 10, YEL, 3) +
        rect(37, 15, 12, 10, a, 3) +
        path("M35 41 25 51h7l-3 8 12-12h-7z", YEL),
    ),
    comms: svg(
      path("M23 40v14M14 58h20", METAL_D, `stroke-width="3"`) +
        path("M8 30a22 22 0 0 0 30 12L14 10A22 22 0 0 0 8 30z", METAL_L) +
        path("M22 28l14-14", "none", `stroke-width="3"`) +
        circle(38, 12, 5, a) +
        path("M46 18a12 12 0 0 1 6 8M50 8a22 22 0 0 1 10 16", "none", `stroke="${a}" stroke-width="3.5"`) +
        shine("M13 24a14 14 0 0 0 6 10", 2.5),
    ),
    card: svg(
      path("M14 14h30M38 8l6 6-6 6", "none", `stroke-width="3"`) +
        rect(5, 24, 54, 34, a, 6) +
        rect(5, 31, 54, 9, INK, 0) +
        rect(11, 45, 14, 9, YEL, 2) +
        rect(31, 46, 20, 3, WHITE, 1) +
        rect(31, 52, 12, 3, WHITE, 1),
    ),
    "data-download": svg(
      path("M23 4h18v18h11L32 42 12 22h11z", GREEN) +
        shine("M27 9v13", 3) +
        rect(5, 44, 54, 16, METAL, 5) +
        rect(10, 49, 44, 6, INK, 3) +
        rect(10, 49, 28, 6, a, 3),
    ),
    "data-upload": svg(
      path("M23 42h18V24h11L32 4 12 24h11z", BLUE) +
        shine("M27 29v13", 3) +
        rect(5, 44, 54, 16, METAL, 5) +
        rect(10, 49, 44, 6, INK, 3) +
        rect(10, 49, 16, 6, a, 3),
    ),
    "fuel-tank": svg(
      path("M16 20v-6a5 5 0 0 1 5-5h12a5 5 0 0 1 5 5v6", "none", `stroke-width="3.5"`) +
        path("M9 22h32l12 12v22a5 5 0 0 1-5 5H14a5 5 0 0 1-5-5z", a) +
        rect(40, 8, 12, 9, YEL, 2) +
        path("M30 33c-6 7-9 10-9 15a9 9 0 0 0 18 0c0-5-3-8-9-15z", YEL) +
        shine("M14 28v22", 3),
    ),
    engine: svg(
      rect(19, 8, 22, 12, METAL, 3) +
        rect(8, 18, 42, 30, a, 6) +
        rect(13, 23, 32, 7, ad, 2) +
        rect(50, 26, 9, 8, METAL, 2) +
        circle(29, 40, 8, METAL_L) +
        circle(29, 40, 3, METAL_D) +
        path("M29 29v3M29 48v3M18 40h3M37 40h3", "none", `stroke-width="3"`) +
        rect(5, 49, 48, 9, METAL_D, 3),
    ),
    wires: svg(
      rect(3, 6, 58, 52, METAL_D, 6) +
        wire("M11 17h10c12 0 12 28 22 28h10", RED) +
        wire("M11 32h10c12 0 12-14 22-14h10", YEL) +
        wire("M11 46h10c12 0 12-14 22-14h10", BLUE) +
        circle(10, 17, 4.5, a) +
        circle(10, 32, 4.5, a) +
        circle(10, 46, 4.5, a) +
        circle(54, 18, 4, METAL_L) +
        circle(54, 32, 4, METAL_L) +
        circle(54, 45, 4, METAL_L),
    ),
    safe: svg(
      rect(10, 56, 8, 5, METAL_D, 1) +
        rect(46, 56, 8, 5, METAL_D, 1) +
        rect(5, 5, 54, 52, METAL, 6) +
        rect(10, 10, 44, 42, a, 4) +
        circle(32, 31, 14, METAL_L) +
        circle(32, 31, 5, METAL_D) +
        path("M32 31l8-8M32 19v4M32 39v4M20 31h4M40 31h4", "none", `stroke-width="2.6"`) +
        shine("M14 16v16", 2.5),
    ),
    distributor: svg(
      rect(5, 6, 54, 52, METAL_D, 6) +
        rect(13, 12, 8, 40, INK, 4) +
        rect(28, 12, 8, 40, INK, 4) +
        rect(43, 12, 8, 40, INK, 4) +
        rect(9, 16, 16, 10, YEL, 3) +
        rect(24, 36, 16, 10, a, 3) +
        rect(39, 24, 16, 10, GREEN, 3),
    ),
    simon: svg(
      rect(3, 3, 58, 58, a, 14) +
        rect(9, 9, 21, 21, GREEN, 6) +
        rect(34, 9, 21, 21, RED, 6) +
        rect(9, 34, 21, 21, YEL, 6) +
        rect(34, 34, 21, 21, BLUE, 6) +
        shine("M13 15a6 6 0 0 1 5-4M38 15a6 6 0 0 1 5-4M13 40a6 6 0 0 1 5-4M38 40a6 6 0 0 1 5-4", 2.5),
    ),
    antenna: svg(
      path("M20 8a16 16 0 0 0 0 16M12 4a24 24 0 0 0 0 24M44 8a16 16 0 0 1 0 16M52 4a24 24 0 0 1 0 24", "none", `stroke="${a}" stroke-width="3.5"`) +
        path("M32 24 21 56h22z", METAL) +
        path("M26 42h12M29 33h6", "none") +
        path("M24 56l16-14M40 56L24 42", "none", `stroke-width="2"`) +
        circle(32, 16, 7, a) +
        shine("M28 13a5 5 0 0 1 4-3", 2.5) +
        rect(14, 55, 36, 6, METAL_D, 2),
    ),
    "key-a": key("A", a),
    "key-b": key("B", a),
    shield: svg(
      path("M32 3 7 12v19c0 15 10 25 25 30 15-5 25-15 25-30V12z", a) +
        path("M32 11 15 17v13c0 10 7 17 17 21 10-4 17-11 17-21V17z", al) +
        path("M32 11v40", "none", `stroke-width="2"`) +
        path("M22 31l7 7 13-14", "none", `stroke="${WHITE}" stroke-width="5.5"`),
    ),
  };
}

/** Siren: the emergency meeting button. */
export function emergencyIcon(accent: string): string {
  return svg(
    path("M32 2v7M9 11l5 5M55 11l-5 5M1 30h8M55 30h8", "none", `stroke="${YEL}" stroke-width="3.5"`) +
      rect(10, 46, 44, 13, METAL_D, 4) +
      path("M15 46V30a17 17 0 0 1 34 0v16z", accent) +
      shine("M21 41V31a11 11 0 0 1 8-10", 3.5) +
      circle(32, 36, 4, YEL),
  );
}

export function stationIcon(id: StationId, accent: string): string {
  return icons(accent)[id];
}
