import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = await createApp(config);
const port = await app.listen();

console.log(`[server] écoute sur ${config.host}:${port}`);
console.log(`[server] joueurs : ${config.publicUrl}/   TV : ${config.publicUrl}/tv   MJ : ${config.publicUrl}/admin`);
if (config.timeScale !== 1) console.log(`[server] accélérateur de temps : x${config.timeScale}`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    console.log(`[server] arrêt (${signal})`);
    void app.close().finally(() => process.exit(0));
  });
}
