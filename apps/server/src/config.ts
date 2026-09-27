import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  publicUrl: string;
  adminPin: string;
  hmacSecret: string;
  dataDir: string;
  webDist: string;
  timeScale: number;
  dev: boolean;
}

function lanAddress(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return "localhost";
}

function loadOrCreateSecret(dataDir: string): string {
  const file = join(dataDir, "hmac_secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dev = env.NODE_ENV !== "production";
  const port = Number(env.PORT ?? 8080);
  const dataDir = resolve(env.DATA_DIR ?? (dev ? "data" : "/app/data"));
  mkdirSync(dataDir, { recursive: true });

  let publicUrl = env.PUBLIC_URL;
  if (!publicUrl) {
    if (!dev) throw new Error("PUBLIC_URL est obligatoire (ex. http://192.168.1.10:8080)");
    publicUrl = `http://${lanAddress()}:${port}`;
    console.warn(`[config] PUBLIC_URL absent, utilisation de ${publicUrl}`);
  }

  let adminPin = env.ADMIN_PIN;
  if (!adminPin) {
    if (!dev) throw new Error("ADMIN_PIN est obligatoire");
    adminPin = "1234";
    console.warn("[config] ADMIN_PIN absent, code de développement : 1234");
  }

  const timeScale = Number(env.TIME_SCALE ?? 1);
  if (!(timeScale > 0)) throw new Error("TIME_SCALE doit être un nombre positif");

  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    publicUrl: publicUrl.replace(/\/+$/, ""),
    adminPin,
    hmacSecret: env.HMAC_SECRET ?? loadOrCreateSecret(dataDir),
    dataDir,
    webDist: resolve(env.WEB_DIST ?? fileURLToPath(new URL("../../web/dist", import.meta.url))),
    timeScale: dev ? timeScale : 1,
    dev,
  };
}
