/**
 * Decodes a QR code from a photo taken with `<input type="file" capture>`. Live camera
 * (`getUserMedia`) needs HTTPS; a photo picked through a file input works over plain HTTP
 * and keeps the player on the page, with their session and socket.
 */

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

/** Longest side tried first, then larger if the code is too small in the photo. */
const SIZES = [1024, 2048];

export async function decodeQrFromFile(file: File): Promise<string | null> {
  const img = await loadImage(file);
  try {
    const native = await nativeDetector();
    if (native) {
      const found = await native.detect(img).catch(() => []);
      if (found[0]?.rawValue) return found[0].rawValue;
    }
    const { default: jsQR } = await import("jsqr");
    for (const max of SIZES) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const result = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
      if (result?.data) return result.data;
      if (scale === 1) break;
    }
    return null;
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("image"));
    };
    img.src = URL.createObjectURL(file);
  });
}

async function nativeDetector(): Promise<Detector | null> {
  const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

export type ScannedLink = { kind: "station"; token: string } | { kind: "report" | "emergency" | "practice"; token: string };

const KINDS = { s: "station", r: "report", e: "emergency", t: "practice" } as const;

/** Reads one of the game's QR links (`/s/`, `/r/`, `/e/`, `/t/` + token); the host is ignored. */
export function parseGameLink(text: string): ScannedLink | null {
  let path: string;
  try {
    path = new URL(text, location.origin).pathname;
  } catch {
    return null;
  }
  const m = /^\/(s|r|e|t)\/([^/]+)\/?$/.exec(path);
  return m ? { kind: KINDS[m[1] as keyof typeof KINDS], token: decodeURIComponent(m[2]!) } : null;
}
