/**
 * Automated Socket.IO players to test without phones.
 *
 *   pnpm simulate --players 8                 full scenario: kill, QR report, sabotage, vote, until game over
 *   pnpm simulate --players 4 --passive       bots join, get ready, arrive and vote "skip" on their own;
 *                                             the game is driven from /admin (useful with a real phone)
 *
 * In both modes, living bots repair every sabotage (reactor, oxygen, lights) at the stations.
 * Options: --url http://localhost:8080  --pin 1234  --seed 42
 */
import type { ClientView, PlayerView, SabotageKind, StationId } from "../packages/shared/src/index";
import { ADMIN_COOKIE, OXYGEN_CODE_STATIONS, PLAYER_COLORS, SABOTAGE_LABEL, SABOTAGE_STATIONS, SESSION_HEADER, SKIP_VOTE } from "../packages/shared/src/index";
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

/** Station codes printed for the current game, read from the admin's printable page. */
async function stationCodes(admin: TestClient): Promise<Map<StationId, string>> {
  const auth = await admin.ok<{ adminToken: string }>("admin:auth", { pin });
  const html = await (await fetch(`${url}/api/print/stations`, { headers: { cookie: `${ADMIN_COOKIE}=${auth!.adminToken}` } })).text();
  return new Map([...html.matchAll(/data-station="([^"]+)"[\s\S]*?Code <b>(\d{4})<\/b>/g)].map((m) => [m[1] as StationId, m[2]!]));
}

/**
 * Living bots repair each new sabotage after a short delay, like players running to the
 * stations: two fingers on the reactor, the O2 codes read at the admin station, the switches.
 */
function autoRepair(bots: Bot[], getCodes: () => Promise<Map<StationId, string>>): void {
  let handled = "";
  const watcher = bots[0];
  if (!watcher) return;
  watcher.c.socket.on("state:sync", async (v: ClientView) => {
    const sabotage = v.kind === "player" && v.phase === "PLAYING" ? v.sabotage : undefined;
    if (!sabotage || sabotage.id === handled) return;
    handled = sabotage.id;
    const codes = await getCodes();
    const at = (id: StationId) => ({ code: codes.get(id)! });
    await sleep(1500 + random() * 2000);
    const alive = bots.filter((b) => pv(b).phase === "PLAYING" && ["ALIVE", "DYING"].includes(status(b)));
    const still = () => pv(watcher).sabotage?.id === sabotage.id;
    if (alive.length === 0 || !still()) return;
    log(`Les bots réparent : ${SABOTAGE_LABEL[sabotage.kind]}`);
    if (sabotage.kind === "reactor") {
      const [a, b] = [pick(alive), pick(alive)];
      const holders = a === b ? [a] : [a, b];
      if (holders.length < 2) return log("Un seul bot vivant : impossible de tenir les deux réacteurs");
      const beat = setInterval(() => {
        for (const [i, h] of holders.entries()) void h.c.send("station:hold", { at: at(SABOTAGE_STATIONS.reactor[i]!), holding: true });
      }, 1500);
      for (const [i, h] of holders.entries()) await h.c.send("station:hold", { at: at(SABOTAGE_STATIONS.reactor[i]!), holding: true });
      await sleep(500);
      clearInterval(beat);
      for (const [i, h] of holders.entries()) await h.c.send("station:hold", { at: at(SABOTAGE_STATIONS.reactor[i]!), holding: false });
    } else if (sabotage.kind === "oxygen") {
      const reader = pick(alive);
      await reader.c.ok("station:open", { at: at("admin") });
      const read = (await reader.c.until((view) => view.kind === "player" && view.sabotage?.codes !== undefined, 5000)) as PlayerView;
      for (const id of OXYGEN_CODE_STATIONS) {
        await sleep(800);
        await reader.c.send("station:code", { at: at(id), code: read.sabotage!.codes![id] });
      }
    } else {
      const fixer = pick(alive);
      const switches = pv(fixer).sabotage?.switches ?? [];
      for (const [i, on] of switches.entries()) if (!on) await fixer.c.send("station:switch", { at: at("electrical"), index: i });
    }
  });
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
  const admin = await new TestClient(url).connected();
  autoRepair(bots, () => stationCodes(admin));
  log("Bots passifs connectés. Pilotez la partie depuis /admin. Ctrl+C pour quitter.");
  await new Promise(() => undefined);
}

async function runScenario(): Promise<void> {
  const admin = await new TestClient(url).connected();
  await admin.ok("admin:auth", { pin });
  const initial = await admin.until((v) => v.kind === "admin");
  if (initial.phase === "GAME_OVER") await admin.ok("admin:backToLobby");
  else if (initial.phase !== "LOBBY") throw new Error(`La partie est en cours (${initial.phase}) : terminez-la depuis /admin`);

  // Offline players left over from a previous game would never act: remove them.
  const lobby = await admin.until((v) => v.phase === "LOBBY");
  for (const p of lobby.players.filter((p) => !p.connected)) await admin.ok("admin:kick", { playerId: p.id });
  const bots = await joinBots(await admin.until((v) => v.players.every((p) => p.connected)));
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
  const codes = await stationCodes(admin);
  autoRepair(bots, async () => codes);
  let sabotaged = false;

  for (let round = 1; round < 30; round++) {
    const state = await admin.until((v) => v.phase === "PLAYING" || v.phase === "GAME_OVER", 120_000);
    if (state.phase === "GAME_OVER") break;

    // Once per game, an impostor bot sabotages as soon as the shared cooldown allows it.
    const enabled = state.params.enabledSabotages;
    const saboteur = impostors.find((b) => pv(b).sabotageCooldownEndsAt !== undefined);
    if (!sabotaged && saboteur && enabled.length > 0) {
      sabotaged = true;
      await sleep(Math.max(0, pv(saboteur).sabotageCooldownEndsAt! - Date.now()) + 300);
      const kind: SabotageKind = pick([...enabled]);
      const res = await saboteur.c.send("player:sabotage", { kind });
      log(res.ok ? `${saboteur.name} sabote : ${SABOTAGE_LABEL[kind]}` : `Sabotage refusé : ${res.error.message}`);
      if (res.ok) await admin.until((v) => v.kind === "admin" && (!v.state.sabotage || v.phase !== "PLAYING"), 120_000);
      if (admin.view?.phase !== "PLAYING") continue;
    }

    // Wait for the team kill cooldown, then an impostor "touches" a crewmate.
    await sleep(Math.max(0, ((admin.view?.kind === "admin" && admin.view.state.killCooldownEndsAt) || 0) - Date.now()) + 200);
    const victims = bots.filter((b) => roleOf(b) === "crew" && status(b) === "ALIVE");
    if (victims.length === 0) break;
    const victim = pick(victims);
    log(`Tour ${round} : ${victim.name} est touché et déclare sa mort`);
    await victim.c.ok("player:declareDeath");
    const after = await victim.c.until((v) => v.kind === "player" && (v.me.status === "BODY" || v.phase !== "PLAYING"), 60_000);
    if (after.phase === "GAME_OVER") break;

    const qr = await victim.c.event("body:qr", 10_000);
    victim.c.events.length = 0;
    const reporters = bots.filter((b) => b !== victim && status(b) === "ALIVE");
    if (reporters.length === 0) {
      log("Aucun bot vivant pour signaler : le MJ signale le corps");
      await admin.ok("admin:callMeeting", { bodyOfId: victim.id });
    } else {
      const reporter = pick(reporters);
      const res = await post("/api/report", reporter.token, { token: qr.token });
      log(`${reporter.name} scanne le corps : ${res.ok ? "réunion !" : res.error?.message}`);
    }

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
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
