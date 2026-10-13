import { join } from "node:path";
import { GameClock } from "./clock";
import type { Config } from "./config";
import { cryptoRng, type Rng } from "./engine";
import { GameRuntime } from "./game";
import { createHttp } from "./http";
import { Persistence } from "./persistence";
import { Tokens } from "./tokens";
import { registerRest } from "./transport/rest";
import { Transport } from "./transport/socket";

export interface AppOptions {
  rng?: Rng;
  clock?: () => number;
  /** SQLite file path; defaults to `<dataDir>/game.sqlite`. */
  dbFile?: string;
}

export async function createApp(config: Config, options: AppOptions = {}) {
  const gameClock = options.clock ? undefined : new GameClock();
  const clock = options.clock ?? gameClock!.now;
  const tokens = new Tokens(config.hmacSecret);
  const persistence = new Persistence(options.dbFile ?? join(config.dataDir, "game.sqlite"));
  const runtime = new GameRuntime(persistence, options.rng ?? cryptoRng, clock, config.timeScale);
  const http = await createHttp(config);

  let transport: Transport | undefined;
  registerRest(http, {
    runtime,
    tokens,
    adminPin: config.adminPin,
    clock,
    emergencyUrl: () => transport!.emergencyUrl(),
    stations: () => transport!.printableStations(),
  });
  await http.ready();
  transport = new Transport(http.server, runtime, { publicUrl: config.publicUrl, adminPin: config.adminPin, tokens, clock });

  // The system clock may be set (NTP) while the server runs: game time catches up in the lobby only.
  const resyncTimer = gameClock
    ? setInterval(() => {
        const idle = runtime.state.phase === "LOBBY" && runtime.pendingTimers().length === 0;
        const drift = gameClock.resyncIfIdle(idle);
        if (drift !== 0) console.warn(`[clock] horloge système décalée de ${Math.round(drift / 1000)} s : temps de jeu recalé`);
      }, 10_000)
    : undefined;

  return {
    http,
    runtime,
    transport,
    tokens,
    persistence,
    async listen(): Promise<number> {
      await http.listen({ port: config.port, host: config.host });
      const address = http.server.address();
      return typeof address === "object" && address ? address.port : config.port;
    },
    async close(): Promise<void> {
      clearInterval(resyncTimer);
      runtime.stop();
      transport!.close();
      await http.close();
      persistence.close();
    },
  };
}

export type App = Awaited<ReturnType<typeof createApp>>;
