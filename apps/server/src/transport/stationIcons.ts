import type { StationId } from "@among-us/shared";

// Line pictograms (64×64) printed next to the station QR codes. Strokes use `currentColor` so a
// template can draw them black on white or white on black; no fills, so they print cleanly in B&W.

const svg = (body: string) =>
  `<svg class="icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const reactor = (side: "left" | "right") =>
  svg(
    `<circle cx="32" cy="28" r="5"/><ellipse cx="32" cy="28" rx="22" ry="8"/><ellipse cx="32" cy="28" rx="22" ry="8" transform="rotate(60 32 28)"/><ellipse cx="32" cy="28" rx="22" ry="8" transform="rotate(-60 32 28)"/>` +
      (side === "left" ? `<path d="M26 56h-14m6-6-6 6 6 6"/>` : `<path d="M38 56h14m-6-6 6 6-6 6"/>`),
  );

const key = (letter: string) =>
  svg(`<circle cx="20" cy="32" r="12"/><path d="M32 32h26m-8 0v9m-9-9v7"/><text x="20" y="37" font-size="14" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">${letter}</text>`);

const ICONS: Record<StationId, string> = {
  "reactor-a": reactor("left"),
  "reactor-b": reactor("right"),
  "o2-a": svg(`<path d="M10 10h44L38 32v18l-12 6V32z"/><circle cx="20" cy="58" r="1"/><circle cx="32" cy="60" r="1"/><circle cx="44" cy="58" r="1"/>`),
  "o2-b": svg(`<rect x="20" y="16" width="24" height="42" rx="10"/><path d="M27 16v-6h10v6M32 10V5"/><text x="32" y="43" font-size="13" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">O₂</text>`),
  admin: svg(`<rect x="6" y="10" width="52" height="34" rx="3"/><path d="M22 54h20M32 44v10M14 20h22M14 28h30M14 36h16"/>`),
  electrical: svg(`<rect x="10" y="6" width="44" height="52" rx="3"/><path d="M36 14 22 34h10l-4 16 14-20H32z"/>`),
  comms: svg(`<path d="M12 30a20 20 0 0 0 28 8L16 14a20 20 0 0 0-4 16z"/><path d="m34 30 14 14M44 24a14 14 0 0 1 8 8M48 16a22 22 0 0 1 12 14M22 56h20M32 46v10"/>`),
  card: svg(`<rect x="6" y="14" width="52" height="34" rx="4"/><path d="M6 24h52M14 38h12M34 38h6"/><path d="M32 52v8m-5-5 5 5 5-5"/>`),
  "data-download": svg(`<path d="M32 6v32m-12-12 12 12 12-12M8 40v14h48V40"/>`),
  "data-upload": svg(`<path d="M32 40V8m-12 12L32 8l12 12M8 40v14h48V40"/>`),
  "fuel-tank": svg(`<path d="M14 18h28l8 8v32H14z"/><path d="M42 18l-6-8H22l-4 8M24 38h16M28 30h8"/>`),
  engine: svg(`<circle cx="32" cy="32" r="10"/><path d="M32 6v10m0 32v10M6 32h10m32 0h10M13 13l7 7m24 24 7 7M51 13l-7 7M20 44l-7 7"/>`),
  wires: svg(`<path d="M6 16h14c14 0 14 16 28 16h10M6 32h14c14 0 14 16 28 16h10M6 48h14c14 0 14-32 28-32h10"/><circle cx="6" cy="16" r="2"/><circle cx="6" cy="32" r="2"/><circle cx="6" cy="48" r="2"/>`),
  safe: svg(`<rect x="8" y="8" width="48" height="48" rx="3"/><circle cx="32" cy="32" r="12"/><path d="M32 32l8-8M32 20v4M32 40v4M20 32h4M40 32h4M14 56v4M50 56v4"/>`),
  distributor: svg(`<path d="M16 8v48M32 8v48M48 8v48"/><rect x="10" y="14" width="12" height="8" rx="2"/><rect x="26" y="34" width="12" height="8" rx="2"/><rect x="42" y="22" width="12" height="8" rx="2"/>`),
  simon: svg(`<rect x="8" y="8" width="22" height="22" rx="5"/><rect x="34" y="8" width="22" height="22" rx="5"/><rect x="8" y="34" width="22" height="22" rx="5"/><rect x="34" y="34" width="22" height="22" rx="5"/>`),
  antenna: svg(`<path d="M32 26v34M20 60h24M32 26 22 56M32 26l10 30"/><circle cx="32" cy="22" r="4"/><path d="M22 14a14 14 0 0 0 0 16M42 14a14 14 0 0 1 0 16M14 8a24 24 0 0 0 0 28M50 8a24 24 0 0 1 0 28"/>`),
  "key-a": key("A"),
  "key-b": key("B"),
  shield: svg(`<path d="M32 6 10 14v16c0 14 9 24 22 28 13-4 22-14 22-28V14z"/><path d="m22 32 7 7 13-14"/>`),
};

/** Siren: the emergency meeting button. */
export function emergencyIcon(): string {
  return svg(`<path d="M16 54V34a16 16 0 0 1 32 0v20z"/><path d="M10 54h44M32 6v6M12 14l4 4M52 14l-4 4M6 28h6M52 28h6M25 34a7 7 0 0 1 7-7"/>`);
}

export function stationIcon(id: StationId): string {
  return ICONS[id];
}
