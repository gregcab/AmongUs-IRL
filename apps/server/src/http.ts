import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import type { Config } from "./config";

/** Fastify instance with health route and the built web app (SPA fallback). */
export async function createHttp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: false });

  app.get("/api/health", async () => ({ ok: true }));

  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) => {
      const isAsset = req.url.startsWith("/assets/");
      if (req.method === "GET" && !isAsset && !req.url.startsWith("/api/") && !req.url.startsWith("/socket.io")) {
        return reply.type("text/html").sendFile("index.html");
      }
      return reply.code(404).send({ ok: false, error: { code: "BAD_REQUEST", message: "Introuvable" } });
    });
  } else {
    console.warn(`[http] build du frontend introuvable (${config.webDist}) : lancez \`pnpm build\` ou utilisez le serveur Vite.`);
  }

  return app;
}
