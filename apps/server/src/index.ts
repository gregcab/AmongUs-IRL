import { loadConfig } from "./config";
import { createHttp } from "./http";

const config = loadConfig();
const app = await createHttp(config);
await app.listen({ port: config.port, host: config.host });
console.log(`[server] http://${config.host}:${config.port} — joueurs : ${config.publicUrl}/`);
