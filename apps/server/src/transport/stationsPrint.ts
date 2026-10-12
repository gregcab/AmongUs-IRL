import { stationDef, type SabotageKind } from "@among-us/shared";
import QRCode from "qrcode";
import { emergencyIcon, stationIcon } from "./stationIcons";
import type { PrintableStation } from "./socket";

// Printable pages (stations, emergency QR): an editor (card template, paper format, selection)
// with a WYSIWYG preview of the sheets. Every template is in the same markup and picked with a
// CSS class, so switching never hits the server. Each card has an accent colour (QR modules,
// picto, border, banner); all colours are dark enough to scan reliably on white paper.

const SABOTAGE_COLOR: Record<SabotageKind, string> = {
  reactor: "#c2410c",
  oxygen: "#1d4ed8",
  lights: "#a16207",
  comms: "#047857",
};
const TASK_COLOR = "#6d28d9";
export const EMERGENCY_COLOR = "#b91c1c";

export function stationColor(id: PrintableStation["id"]): string {
  const { sabotage } = stationDef(id);
  return sabotage ? SABOTAGE_COLOR[sabotage] : TASK_COLOR;
}

/** One card of a printable page. */
export interface PrintItem {
  id: string;
  name: string;
  location: string;
  url: string;
  /** Code typed in the app when the camera opens another browser; the emergency QR has none. */
  code?: string;
  purpose: string;
  color: string;
  icon: string;
}

export interface PrintPageOptions {
  title: string;
  intro: string;
  /** Shown instead of the editor when there is nothing to print. */
  empty: string;
  defaults: { format: string; template: string };
}

/** Share of the QR side covered by the centred badge of the « picto dans le QR » template. */
export const QR_BADGE_RATIO = 0.22;
const QR_MARGIN = 2;

export interface QrMatrix {
  size: number;
  dark: (row: number, col: number) => boolean;
}

/** Error correction `H` (30 %) so the centre of the code can carry the badge of the picto template. */
export function qrMatrix(url: string): QrMatrix {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "H" });
  return { size: modules.size, dark: (r, c) => modules.get(r, c) === 1 };
}

/** The central square (in modules, quiet zone excluded) left blank for the badge. */
export function badgeBounds(size: number): { from: number; to: number } {
  const side = Math.round(size * QR_BADGE_RATIO);
  const from = Math.floor((size - side) / 2);
  return { from, to: from + side };
}

export function qrSvg(url: string, icon: string, color = "#000"): string {
  const m = qrMatrix(url);
  const total = m.size + 2 * QR_MARGIN;
  let path = "";
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.dark(r, c)) path += `M${c + QR_MARGIN} ${r + QR_MARGIN}h1v1h-1z`;
  const { from, to } = badgeBounds(m.size);
  const side = to - from;
  const x = from + QR_MARGIN;
  const pad = side * 0.06;
  // The badge is part of the QR svg but hidden unless the « picto dans le QR » template is active.
  const inner = icon.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const badge =
    `<g class="badge"><rect x="${x}" y="${x}" width="${side}" height="${side}" fill="#fff"/>` +
    `<svg x="${x + pad}" y="${x + pad}" width="${side - 2 * pad}" height="${side - 2 * pad}" viewBox="0 0 64 64" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg></g>`;
  return `<svg viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="${color}"/>${badge}</svg>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function card(it: PrintItem): string {
  return `<section class="card" data-station="${it.id}" style="--c:${it.color}">
  <div class="face">
    <div class="pic">${it.icon}</div>
    <div class="titles"><div class="name">${escapeHtml(it.name)}</div>${it.location ? `<div class="loc">${escapeHtml(it.location)}</div>` : ""}</div>
    <div class="qr">${qrSvg(it.url, it.icon, it.color)}</div>
    ${it.code ? `<div class="code">Code <b>${it.code}</b></div>` : ""}
    <div class="purpose">${escapeHtml(it.purpose)}</div>
  </div>
</section>`;
}

const STYLE = `
  :root { --u: 1cqmin; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; color: #000; background: #e4e4e7; margin: 0; }
  .toolbar { position: sticky; top: 0; z-index: 2; background: #fff; border-bottom: 1px solid #bbb; padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; }
  .toolbar h1 { font-size: 16pt; margin: 0 8px 0 0; }
  .toolbar label { font-size: 11pt; display: flex; gap: 6px; align-items: center; }
  .toolbar select, .toolbar button { font-size: 11pt; padding: 4px 8px; }
  .toolbar .grow { flex: 1 1 100%; font-size: 10pt; color: #444; margin: 0; }
  .picker { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 10pt; flex: 1 1 100%; }
  .picker label { font-size: 10pt; }
  #sheets { padding: 16px 0; display: flex; flex-direction: column; align-items: center; gap: 16px; transform-origin: top center; }
  .sheet { background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, .3); display: grid; overflow: hidden; flex: none; }
  .empty { text-align: center; font-size: 14pt; padding: 20px; }
  #pool { display: none; }

  /* The card is the size container: cq units only resolve inside it, hence the inner .face. */
  .card { container-type: size; border: 1mm solid var(--c, #000); border-radius: 4mm; background: #fff; overflow: hidden; min-height: 0; }
  .face { width: 100%; height: 100%; text-align: center;
    display: grid; justify-content: center; align-content: center; justify-items: center; align-items: center; padding: calc(3 * var(--u)); row-gap: calc(1.5 * var(--u)); }
  .face > * { min-width: 0; }
  .name { font-size: calc(7.5 * var(--u)); font-weight: 800; line-height: 1.1; }
  .loc { font-size: calc(4.2 * var(--u)); margin-top: calc(.5 * var(--u)); }
  .qr > svg { display: block; width: 100%; height: 100%; }
  .pic { color: var(--c, #000); }
  .pic .icon { display: block; width: 100%; height: 100%; }
  .code { font-size: calc(4.6 * var(--u)); }
  .code b { font-size: calc(6.4 * var(--u)); letter-spacing: .15em; }
  .purpose { font-size: calc(3.3 * var(--u)); color: #333; line-height: 1.2; max-width: 92%; }
  .badge { display: none; }

  /* Côte à côte */
  .t-side .face { grid-template-columns: calc(34 * var(--u)) calc(50 * var(--u)); column-gap: calc(4 * var(--u));
    grid-template-areas: "titles titles" "pic qr" "code code" "purpose purpose"; }
  .t-side .titles { grid-area: titles; } .t-side .pic { grid-area: pic; width: calc(34 * var(--u)); height: calc(34 * var(--u)); }
  .t-side .qr { grid-area: qr; width: calc(50 * var(--u)); height: calc(50 * var(--u)); }
  .t-side .code { grid-area: code; } .t-side .purpose { grid-area: purpose; }

  /* Picto dans le QR */
  .t-inqr .face { grid-template-columns: 1fr; grid-template-areas: "titles" "qr" "code" "purpose"; }
  .t-inqr .pic { display: none; } .t-inqr .badge { display: inline; }
  .t-inqr .titles { grid-area: titles; } .t-inqr .qr { grid-area: qr; width: calc(60 * var(--u)); height: calc(60 * var(--u)); }
  .t-inqr .code { grid-area: code; } .t-inqr .purpose { grid-area: purpose; }

  /* Bandeau */
  .t-banner .face { padding: 0; row-gap: calc(2 * var(--u)); grid-template-columns: calc(24 * var(--u)) 1fr; justify-content: stretch; column-gap: 0; align-content: start;
    grid-template-areas: "pic titles" "qr qr" "code code" "purpose purpose"; }
  .t-banner .pic { grid-area: pic; background: var(--c, #000); color: #fff; width: 100%; height: 100%; padding: calc(4 * var(--u)); }
  .t-banner .titles { grid-area: titles; background: var(--c, #000); color: #fff; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 calc(3 * var(--u)) 0 0; text-align: left; }
  .t-banner .qr { grid-area: qr; width: calc(56 * var(--u)); height: calc(56 * var(--u)); }
  .t-banner .code { grid-area: code; } .t-banner .purpose { grid-area: purpose; }

  /* Compact / autocollant */
  .t-compact .face { grid-template-columns: calc(11 * var(--u)) auto; column-gap: calc(2.5 * var(--u)); padding: calc(2.5 * var(--u));
    grid-template-areas: "pic titles" "qr qr" "code code"; }
  .t-compact .pic { grid-area: pic; width: calc(11 * var(--u)); height: calc(11 * var(--u)); }
  .t-compact .titles { grid-area: titles; text-align: left; } .t-compact .loc, .t-compact .purpose { display: none; }
  .t-compact .name { font-size: calc(6.5 * var(--u)); }
  .t-compact .qr { grid-area: qr; width: calc(72 * var(--u)); height: calc(72 * var(--u)); } .t-compact .code { grid-area: code; }

  /* QR seul */
  .t-qr .face { grid-template-columns: 1fr; grid-template-areas: "titles" "qr" "code" "purpose"; }
  .t-qr .pic { display: none; }
  .t-qr .titles { grid-area: titles; } .t-qr .qr { grid-area: qr; width: calc(62 * var(--u)); height: calc(62 * var(--u)); }
  .t-qr .code { grid-area: code; } .t-qr .purpose { grid-area: purpose; }

  @media print {
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: #fff; }
    .toolbar { display: none; }
    #sheets { padding: 0; gap: 0; display: block; zoom: 1 !important; }
    .sheet { box-shadow: none; break-after: page; page-break-after: always; }
    .sheet:last-child { break-after: auto; page-break-after: auto; }
  }
`;

const script = (page: string, defaults: PrintPageOptions["defaults"]) => `
(function () {
  var FORMATS = {
    "a4-1": { label: "A4, 1 par page", w: 210, h: 297, c: 1, r: 1, pad: 8, gap: 0 },
    "a4-2": { label: "A4, 2 par page", w: 210, h: 297, c: 1, r: 2, pad: 8, gap: 6 },
    "a4-4": { label: "A4, 4 par page", w: 210, h: 297, c: 2, r: 2, pad: 8, gap: 6 },
    "a5-1": { label: "A5, 1 par page", w: 148, h: 210, c: 1, r: 1, pad: 6, gap: 0 },
    "a6-1": { label: "A6, 1 par page (autocollant)", w: 105, h: 148, c: 1, r: 1, pad: 4, gap: 0 }
  };
  var TEMPLATES = { side: "Picto à côté du QR", inqr: "Picto dans le QR", banner: "Bandeau", compact: "Compact / autocollant", qr: "QR seul" };
  var DEFAULTS = ${JSON.stringify(defaults)};
  var PAGE = "${page}";
  var params = new URLSearchParams(location.search);
  function load(key, valid) {
    var v = params.get(key);
    if (v && valid[v]) return v;
    try { v = localStorage.getItem("print-" + PAGE + "-" + key); } catch (e) { v = null; }
    return v && valid[v] ? v : DEFAULTS[key];
  }
  var state = { format: load("format", FORMATS), template: load("template", TEMPLATES) };
  var pool = document.getElementById("pool");
  var sheets = document.getElementById("sheets");
  var cards = Array.prototype.slice.call(pool.children);
  var checks = {};

  function fill(select, options, key) {
    Object.keys(options).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k; o.textContent = typeof options[k] === "string" ? options[k] : options[k].label;
      select.appendChild(o);
    });
    select.value = state[key];
    select.onchange = function () {
      state[key] = select.value;
      try { localStorage.setItem("print-" + PAGE + "-" + key, select.value); } catch (e) {}
      render();
    };
  }
  fill(document.getElementById("format"), FORMATS, "format");
  fill(document.getElementById("template"), TEMPLATES, "template");

  var picker = document.getElementById("picker");
  if (cards.length < 2) document.getElementById("selection").style.display = "none";
  cards.forEach(function (card) {
    var label = document.createElement("label");
    var box = document.createElement("input");
    box.type = "checkbox"; box.checked = true; box.onchange = render;
    checks[card.dataset.station] = box;
    label.appendChild(box);
    label.appendChild(document.createTextNode(" " + card.querySelector(".name").textContent));
    picker.appendChild(label);
  });
  document.getElementById("all").onclick = function () { Object.keys(checks).forEach(function (k) { checks[k].checked = true; }); render(); };
  document.getElementById("none").onclick = function () { Object.keys(checks).forEach(function (k) { checks[k].checked = false; }); render(); };
  document.getElementById("print").onclick = function () { window.print(); };

  function render() {
    var f = FORMATS[state.format];
    document.body.className = "t-" + state.template;
    document.getElementById("pagesize").textContent = "@page { size: " + f.w + "mm " + f.h + "mm; margin: 0; }";
    cards.forEach(function (c) { pool.appendChild(c); });
    sheets.textContent = "";
    var chosen = cards.filter(function (c) { return checks[c.dataset.station].checked; });
    var per = f.c * f.r;
    for (var i = 0; i < chosen.length; i += per) {
      var sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.style.cssText = "width:" + f.w + "mm;height:" + f.h + "mm;padding:" + f.pad + "mm;gap:" + f.gap + "mm;grid-template-columns:repeat(" + f.c + ",1fr);grid-template-rows:repeat(" + f.r + ",1fr)";
      chosen.slice(i, i + per).forEach(function (c) { sheet.appendChild(c); });
      sheets.appendChild(sheet);
    }
    if (!chosen.length) sheets.innerHTML = '<p class="empty">Aucune station sélectionnée.</p>';
    fit();
  }
  function fit() {
    var f = FORMATS[state.format];
    var scale = Math.min(1, (window.innerWidth - 24) / (f.w * 96 / 25.4));
    sheets.style.zoom = scale;
  }
  window.addEventListener("resize", fit);
  render();
})();
`;

export function printPage(page: string, items: PrintItem[], o: PrintPageOptions): string {
  if (items.length === 0) {
    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${o.title}</title><style>${STYLE}</style></head>
<body><p class="empty">${o.empty}</p></body></html>`;
  }
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${o.title}</title>
<style id="pagesize">@page { size: A4; margin: 0; }</style>
<style>${STYLE}</style></head>
<body class="t-side">
  <header class="toolbar">
    <h1>${o.title}</h1>
    <label>Modèle <select id="template"></select></label>
    <label>Format <select id="format"></select></label>
    <button id="print">Imprimer</button>
    <p class="grow">Choisissez le même format de papier dans la boîte d'impression du navigateur (marges : aucune). ${o.intro}</p>
    <div class="picker" id="picker"><span id="selection"><button id="all" type="button">Tout</button> <button id="none" type="button">Aucune</button></span></div>
  </header>
  <div id="sheets"></div>
  <div id="pool">
${items.map(card).join("\n")}
  </div>
  <script>${script(page, o.defaults)}</script>
</body></html>`;
}

export function stationsPage(stations: PrintableStation[]): string {
  const items = stations.map((st) => ({
    id: st.id,
    name: st.name,
    location: st.location,
    url: st.url,
    code: st.code,
    purpose: stationDef(st.id).purpose,
    color: stationColor(st.id),
    icon: stationIcon(st.id),
  }));
  return printPage("stations", items, {
    title: "Stations",
    intro: "Scannez avec l'appareil photo du téléphone qui vous sert à jouer, ou tapez le code dans le jeu. Valables uniquement pour la partie en cours.",
    empty: "Aucune station à imprimer : activez des sabotages ou des tâches dans les paramètres.",
    defaults: { format: "a4-2", template: "side" },
  });
}

export function emergencyPage(url: string): string {
  const item: PrintItem = {
    id: "emergency",
    name: "Réunion d'urgence",
    location: "",
    url,
    purpose: "Scannez avec l'appareil photo du téléphone qui vous sert à jouer. Valable uniquement pour la partie en cours.",
    color: EMERGENCY_COLOR,
    icon: emergencyIcon(),
  };
  return printPage("emergency", [item], {
    title: "Station d'urgence",
    intro: "Valable uniquement pour la partie en cours.",
    empty: "",
    defaults: { format: "a4-1", template: "banner" },
  });
}
