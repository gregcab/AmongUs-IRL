/**
 * Automated Socket.IO players to test without phones.
 *
 *   pnpm simulate --players 8                 full scenario: kill, QR report, vote, until game over
 *   pnpm simulate --players 4 --passive       bots join, get ready, arrive and vote "skip" on their own;
 *                                             the game is driven from /admin (useful with a real phone)
 *
 * Options: --url http://localhost:8080  --pin 1234  --seed 42
 */
import type { ClientView, PlayerView } from "../packages/shared/src/index";
import { PLAYER_COLORS, SESSION_HEADER, SKIP_VOTE } from "../packages/shared/src/index";
import { TestClient } from "../apps/server/test/client";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : fallback;
}

const url = arg("url", process.env.SIM_URL ?? "http://localhost:8080");
const pin = arg("pin", process.env.ADMIN_PIN ?? "1234");
const count = Number(arg("players", "6"));
const passive = process.argv.includes("--passive");
let seed = Number(arg("seed", String(Date.now() % 100000)));

const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...parts: unknown[]) => console.log(`[${new Date().toLocaleTimeString("fr-FR")}]`, ...parts);

interface Bot {
  c: TestClient;
  id: string;
  name: string;
  token: string;
}

const pv = (b: Bot) => b.c.view as PlayerView;
const status = (b: Bot) => pv(b).me.status;

async function joinBots(existing: ClientView | undefined): Promise<Bot[]> {
  const taken = new Set(existing?.players.map((p) => p.color) ?? []);
  const names = new Set(existing?.players.map((p) => p.name.toLowerCase()) ?? []);
  const colors = PLAYER_COLORS.filter((c) => !taken.has(c.id));
  const bots: Bot[] = [];
  for (let i = 0; i < count && i < colors.length; i++) {
    let name = `Bot${i + 1}`;
    for (let n = i + 1; names.has(name.toLowerCase()); n += count) name = `Bot${n}`;
    names.add(name.toLowerCase());
    const c = await new TestClient(url).connected();
    const data = await c.ok<{ token: string }>("lobby:join", { name, color: colors[i]!.id });
    const view = (await c.until((v) => v.kind === "player")) as PlayerView;
    await c.ok("lobby:ready");
    bots.push({ c, id: view.me.id, name, token: data!.token });
  }
  log(`${bots.length} bots prêts : ${bots.map((b) => b.name).join(", ")}`);
  return bots;
}

/** Bots take part in meetings on their own: arrive, then vote after a short delay. */
function autoMeeting(bots: Bot[], chooseVote: (bot: Bot) => string): void {
  for (const bot of bots) {
    let handled = "";
    bot.c.socket.on("state:sync", async (v: ClientView) => {
      if (v.kind !== "player" || !v.meeting || v.me.status !== "ALIVE") return;
      const key = `${v.meeting.id}:${v.meeting.subPhase}`;
      if (key === handled) return;
      handled = key;
      await sleep(300 + random() * 700);
      if (v.meeting.subPhase === "GATHERING") await bot.c.send("player:arrived");
      if (v.meeting.subPhase === "VOTING") await bot.c.send("player:vote", { targetId: chooseVote(bot) });
    });
  }
}

async function post(path: string, token: string, body: unknown) {
  const res = await fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: token },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok: boolean; error?: { message: string } };
}

async function runPassive(): Promise<void> {
  const probe = await new TestClient(url).connected();
  const view = await probe.until(() => true);
  probe.close();
  const bots = await joinBots(view);
  autoMeeting(bots, () => SKIP_VOTE);
  log("Bots passifs connectés. Pilotez la partie depuis /admin. Ctrl+C pour quitter.");
  await new Promise(() => undefined);
}

async function runScenario(): Promise<void> {
  const admin = await new TestClient(url).connected();
  await admin.ok("admin:auth", { pin });
  const initial = await admin.until((v) => v.kind === "admin");
  if (initial.phase === "GAME_OVER") await admin.ok("admin:backToLobby");
  else if (initial.phase !== "LOBBY") throw new Error(`La partie est en cours (${initial.phase}) : terminez-la depuis /admin`);

  const bots = await joinBots(initial);
  const byId = new Map(bots.map((b) => [b.id, b]));
  await admin.ok("admin:updateParams", { params: { minPlayers: Math.min(4, bots.length) } });
  await admin.ok("admin:start", { force: true });
  log("Partie lancée");
  await admin.until((v) => v.phase === "PLAYING", 60_000);

  const roleOf = (b: Bot) => pv(b).me.role;
  const impostors = bots.filter((b) => roleOf(b) === "impostor");
  log(`Imposteurs : ${impostors.map((b) => b.name).join(", ") || "(joueur humain)"}`);

  // Crewmates vote for a random living player, sometimes an impostor; impostors vote for a crewmate.
  autoMeeting(bots, (bot) => {
    const alive = pv(bot).meeting?.alive ?? [];
    const others = alive.filter((id) => id !== bot.id);
    const crewTargets = others.filter((id) => byId.get(id) && roleOf(byId.get(id)!) === "crew");
    if (roleOf(bot) === "impostor") return crewTargets.length ? pick(crewTargets) : SKIP_VOTE;
    const suspect = others.find((id) => byId.get(id) && roleOf(byId.get(id)!) === "impostor");
    return suspect && random() < 0.45 ? suspect : others.length ? pick(others) : SKIP_VOTE;
  });

  for (let round = 1; round < 30; round++) {
    const state = await admin.until((v) => v.phase === "PLAYING" || v.phase === "GAME_OVER", 120_000);
    if (state.phase === "GAME_OVER") break;

    // Wait for the team kill cooldown, then an impostor "touches" a crewmate.
    await admin.until((v) => v.kind === "admin" && (v.state.killCooldownEndsAt ?? 0) <= Date.now() + 200, 120_000);
    const victims = bots.filter((b) => roleOf(b) === "crew" && status(b) === "ALIVE");
    if (victims.length === 0) break;
    const victim = pick(victims);
    log(`Tour ${round} : ${victim.name} est touché et déclare sa mort`);
    await victim.c.ok("player:declareDeath");
    await victim.c.until((v) => v.kind === "player" && (v.me.status === "BODY" || v.phase !== "PLAYING"), 60_000);
    if (admin.view?.phase === "GAME_OVER") break;

    const qr = await victim.c.event("body:qr", 10_000);
    victim.c.events.length = 0;
    const reporters = bots.filter((b) => b !== victim && status(b) === "ALIVE");
    const reporter = pick(reporters);
    const res = await post("/api/report", reporter.token, { token: qr.token });
    log(`${reporter.name} scanne le corps : ${res.ok ? "réunion !" : res.error?.message}`);

    // Push the meeting forward when humans are slow.
    const meeting = await admin.until((v) => v.phase !== "PLAYING", 10_000);
    if (meeting.phase === "GAME_OVER") break;
    await admin.until((v) => v.meeting?.subPhase !== "GATHERING", 60_000);
    await admin.ok("admin:advancePhase"); // skip the discussion
    const result = await admin.until((v) => v.phase !== "MEETING" || v.meeting?.subPhase === "RESULT", 120_000);
    if (result.phase === "MEETING" && result.meeting?.result) {
      const ejected = result.players.find((p) => p.id === result.meeting!.result!.ejectedId);
      log(ejected ? `${ejected.name} est éjecté` : "Personne n'est éjecté");
      await admin.ok("admin:advancePhase");
    }
  }

  const over = await admin.until((v) => v.phase === "GAME_OVER", 120_000);
  log(`Fin : ${over.gameOver?.winner === "crew" ? "victoire des équipiers" : "victoire des imposteurs"}`);
  for (const b of bots) b.c.close();
  admin.close();
}

(passive ? runPassive() : runScenario())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
