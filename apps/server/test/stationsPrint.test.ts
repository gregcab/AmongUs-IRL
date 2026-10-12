import { STATION_IDS } from "@among-us/shared";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { stationIcon } from "../src/transport/stationIcons";
import type { PrintableStation } from "../src/transport/socket";
import { badgeBounds, emergencyPage, EMERGENCY_COLOR, qrMatrix, stationColor, stationsPage } from "../src/transport/stationsPrint";

describe("station print page", () => {
  it("has an icon for every station", () => {
    for (const id of STATION_IDS) expect(stationIcon(id)).toMatch(/^<svg class="icon"[\s\S]*<\/svg>$/);
  });

  it.each([...STATION_IDS.map((id) => [id, stationColor(id)] as const), ["emergency", EMERGENCY_COLOR] as const])(
    "keeps the QR code readable with the centre badge and the %s colour %s",
    (_, color) => {
    const url = "http://192.168.1.10:8080/s/" + "x".repeat(70);
    const m = qrMatrix(url);
    const scale = 6;
    const margin = 4;
    const px = (m.size + 2 * margin) * scale;
    const data = new Uint8ClampedArray(px * px * 4).fill(255);
    const { from, to } = badgeBounds(m.size);
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++) {
        const r = Math.floor(y / scale) - margin;
        const c = Math.floor(x / scale) - margin;
        const inside = r >= 0 && c >= 0 && r < m.size && c < m.size;
        const covered = r >= from && r < to && c >= from && c < to;
        if (inside && !covered && m.dark(r, c)) {
          const i = (y * px + x) * 4;
          data[i] = parseInt(color.slice(1, 3), 16);
          data[i + 1] = parseInt(color.slice(3, 5), 16);
          data[i + 2] = parseInt(color.slice(5, 7), 16);
        }
      }
    expect(jsQR(data, px, px)?.data).toBe(url);
    },
  );

  it("renders one card per station with the code after the station id", () => {
    const stations = [
      { id: "card", name: "Lecteur <b>", location: "Salon", url: "http://x/s/abc", code: "1234" },
      { id: "safe", name: "Coffre", location: "", url: "http://x/s/def", code: "5678" },
    ] as unknown as PrintableStation[];
    const html = stationsPage(stations);
    expect(html).toContain("Lecteur &lt;b&gt;");
    expect(html).toMatch(/data-station="card"[\s\S]*?Code <b>1234<\/b>/);
    expect(html).toMatch(/data-station="safe"[\s\S]*?Code <b>5678<\/b>/);
    expect(stationsPage([])).toContain("Aucune station");
  });

  it("renders the emergency page as a coloured card without a code", () => {
    const html = emergencyPage("http://x/e/abc");
    expect(html).toContain('data-station="emergency"');
    expect(html).toContain(`--c:${EMERGENCY_COLOR}`);
    expect(html).toContain('class="icon"');
    expect(html).not.toContain("Code <b>");
  });
});
