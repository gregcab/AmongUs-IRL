/**
 * Regenerates the README screenshots in docs/screenshots/ by playing a scripted game
 * against an in-process server, with bots and real Chrome pages (phone, TV, admin).
 *
 *   pnpm build && pnpm screenshots
 *
 * Requires Google Chrome installed locally (driven through playwright-core).
 */
import { SESSION_HEADER, type PlayerView } from "../packages/shared/src/index";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright-core";
import { createApp, type App } from "../apps/server/src/app";
import { seededRng } from "../apps/server/src/engine";
import { TestClient } from "../apps/server/test/client";

const OUT = resolve("docs/screenshots");
const WEB_DIST = resolve("apps/web/dist");
const PIN = "1234";

const PHONE: BrowserContextOptions = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TV: BrowserContextOptions = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 };
const DESKTOP: BrowserContextOptions = { viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 };

// Headless Chrome refuses the Wake Lock; a stub keeps the "tap to re-enable" banner away.
const STUB_WAKE_LOCK = () => {
  const sentinel = { release: async () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined };
  Object.defineProperty(navigator, "wakeLock", { value: { request: async () => sentinel }, configurable: true });
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...parts: unknown[]) => console.log("[screenshots]", ...parts);

interface Bot {
  c: TestClient;
  id: string;
  name: string;
  token: string;
}

async function main(): Promise<void> {
  if (!existsSync(join(WEB_DIST, "index.html"))) throw new Error("Lancez d'abord `pnpm build`");
  mkdirSync(OUT, { recursive: true });
  const dataDir = mkdtempSync(join(tmpdir(), "amongus-shots-"));

  const app = await createApp(
    {
      port: 0,
      host: "127.0.0.1",
      publicUrl: "http://192.168.1.10:8080",
      adminPin: PIN,
      hmacSecret: "screenshots",
      dataDir,
      webDist: WEB_DIST,
      timeScale: 1,
      dev: true,
    },
    { rng: seededRng(4), dbFile: join(dataDir, "game.sqlite") },
  );
  const port = await app.listen();
  const url = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });

  try {
    await play(browser, url, app);
  } finally {
    await browser.close();
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function open(browser: Browser, url: string, options: BrowserContextOptions, storage: Record<string, string> = {}): Promise<Page> {
  const context = await browser.newContext(options);
  await context.addInitScript(STUB_WAKE_LOCK);
  await context.addInitScript((items: Record<string, string>) => {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
  }, storage);
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

async function shot(page: Page, name: string, settleMs = 600): Promise<void> {
  await sleep(settleMs);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  log(name);
}

/** The first tap re-arms sound and the wake lock, like a real player would. */
async function tap(page: Page): Promise<void> {
  await page.mouse.click(2, 2);
}

async function holdReveal(page: Page): Promise<void> {
  await page.locator(".reveal").first().dispatchEvent("pointerdown", { pointerId: 1 });
}

/** Holds the role pad, then slides onto the hidden sabotage target and releases there. */
async function openSabotageMenu(page: Page): Promise<void> {
  const pad = page.locator(".reveal").first();
  const box = (await pad.boundingBox())!;
  await pad.dispatchEvent("pointerdown", { pointerId: 2, clientX: box.x + box.width / 2, clientY: box.y + 20 });
  const target = (await page.locator(".sabotage-target").boundingBox())!;
  await pad.dispatchEvent("pointerup", { pointerId: 2, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 });
  await page.locator(".sabotage-menu").waitFor();
}

async function play(browser: Browser, url: string, app: App): Promise<void> {
  const adminToken = app.tokens.adminToken(PIN);
  const stationUrl = (id: string) => `${url}/s/${app.tokens.stationToken(app.runtime.state.gameId, id)}`;
  const admin = await new TestClient(url).connected();
  await admin.ok("admin:auth", { pin: PIN });
  await admin.ok("admin:updateParams", {
    params: {
      roleRevealSeconds: 120,
      deathDelaySeconds: 0,
      killCooldownSeconds: 600,
      gatheringTimeoutSeconds: 900,
      discussionSeconds: 900,
      votingSeconds: 600,
      resumeCountdownSeconds: 120,
      emergencyCooldownSeconds: 0,
      sabotageCooldownSeconds: 5,
      sabotageCriticalSeconds: 600,
    },
  });
  for (const [stationId, location] of [
    ["reactor-a", "Garage"],
    ["reactor-b", "Jardin"],
    ["o2-a", "Cuisine"],
    ["o2-b", "Chambre"],
    ["admin", "Salon"],
    ["electrical", "Entrée"],
  ]) {
    await admin.ok("admin:updateStation", { stationId, name: "", location });
  }

  const bots: Bot[] = [];
  const addBot = async (name: string, color: string) => {
    const c = await new TestClient(url).connected();
    const data = await c.ok<{ token: string }>("lobby:join", { name, color });
    const v = (await c.until((v) => v.kind === "player")) as PlayerView;
    await c.ok("lobby:ready");
    bots.push({ c, id: v.me.id, name, token: data!.token });
  };
  for (const [name, color] of [
    ["Léa", "red"],
    ["Hugo", "blue"],
    ["Chloé", "pink"],
    ["Nathan", "green"],
  ]) {
    await addBot(name!, color!);
  }

  // Phone: join screen, then lobby.
  const phone = await open(browser, url, PHONE);
  await phone.getByPlaceholder("Pseudo").fill("Camille");
  await phone.getByRole("button", { name: "Cyan" }).click();
  await shot(phone, "phone-join");
  await phone.getByRole("button", { name: "Rejoindre la partie" }).click();
  await phone.getByRole("button", { name: "Je suis prêt" }).click();
  await phone.getByText("En attente du lancement").waitFor();

  for (const [name, color] of [
    ["Inès", "orange"],
    ["Lucas", "yellow"],
    ["Emma", "purple"],
  ]) {
    await addBot(name!, color!);
  }
  await shot(phone, "phone-lobby");

  const tv = await open(browser, `${url}/tv`, TV);
  await tv.getByRole("button", { name: "Cliquer pour activer le son" }).click();
  await tv.getByText("Équipage").waitFor();
  await shot(tv, "tv-lobby");

  // Start: roles.
  await admin.ok("admin:start", {});
  const adminView = await admin.until((v) => v.kind === "admin" && v.phase === "ROLE_REVEAL");
  if (adminView.kind !== "admin") throw new Error("admin view expected");
  const roleOf = (id: string) => adminView.state.players[id]?.role;
  const impostors = bots.filter((b) => roleOf(b.id) === "impostor");
  const crew = bots.filter((b) => roleOf(b.id) === "crew");
  log(`imposteurs : ${impostors.map((b) => b.name).join(", ")}`);

  await tv.getByText("Découvrez votre rôle").waitFor();
  await shot(tv, "tv-reveal");

  const impostorPhone = await open(browser, url, PHONE, { "amongus.session": impostors[0]!.token });
  await impostorPhone.getByText("Découvre ton rôle").waitFor();
  await tap(impostorPhone);
  await holdReveal(impostorPhone);
  await shot(impostorPhone, "phone-role-impostor");
  await impostorPhone.context().close();

  await admin.ok("admin:advancePhase");
  await phone.getByText("Partie en cours").waitFor();
  await tap(phone);
  await shot(phone, "phone-playing");

  // Sabotage: the impostor's hidden menu, then the reactor alarm everywhere.
  const saboteurPhone = await open(browser, url, PHONE, { "amongus.session": impostors[0]!.token });
  await saboteurPhone.getByText("Partie en cours").waitFor();
  await tap(saboteurPhone);
  await sleep(5500); // shared sabotage cooldown
  await openSabotageMenu(saboteurPhone);
  await shot(saboteurPhone, "phone-sabotage-menu");
  await saboteurPhone.getByRole("button", { name: /Réacteur/ }).click();
  await saboteurPhone.context().close();
  await phone.locator(".sabotage-info").waitFor();
  await Promise.all([shot(phone, "phone-sabotage", 4200), shot(tv, "tv-sabotage", 4200)]);

  // Camille runs to the left reactor station and keeps a finger on it.
  await phone.goto(stationUrl("reactor-a"));
  await phone.locator(".reactor-pad").waitFor();
  await tap(phone);
  await phone.locator(".reactor-pad").dispatchEvent("pointerdown", { pointerId: 3 });
  await shot(phone, "phone-station-reactor");
  const helper = crew.find((b) => b.id !== crew[0]!.id && b.id !== crew[1]!.id) ?? crew[0]!;
  await helper.c.ok("station:hold", { at: { token: stationUrl("reactor-b").split("/s/")[1] }, holding: true });
  await phone.getByText("Réparé").waitFor();
  await phone.locator(".reactor-pad, .station-idle").first().waitFor();
  await phone.getByRole("button", { name: "Retour au jeu" }).click();
  await phone.getByText("Partie en cours").waitFor();

  // Kill: the victim's phone becomes the body.
  const [victim, reporter] = crew as [Bot, Bot];
  await victim.c.ok("player:declareDeath");
  const qr = await victim.c.event("body:qr");
  const bodyPhone = await open(browser, url, PHONE, { "amongus.session": victim.token });
  await bodyPhone.locator(".body-screen canvas").waitFor();
  await tap(bodyPhone);
  await shot(bodyPhone, "phone-body");
  await bodyPhone.context().close();

  // Report by scanning the QR: alarm everywhere.
  const res = await fetch(`${url}/api/report`, {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: reporter.token },
    body: JSON.stringify({ token: qr.token }),
  });
  if (!res.ok) throw new Error(`report failed: ${res.status}`);
  await Promise.all([shot(phone, "phone-alarm", 900), shot(tv, "tv-alarm", 900)]);

  // Gathering → discussion → vote.
  const alive = () => bots.filter((b) => (b.c.view as PlayerView | undefined)?.me.status === "ALIVE");
  await admin.until((v) => v.meeting?.subPhase === "GATHERING");
  await sleep(5500);
  for (const b of alive()) await b.c.ok("player:arrived");
  await shot(phone, "phone-gathering");
  await phone.getByRole("button", { name: "Je suis arrivé" }).click();
  await tv.getByText("Discussion").first().waitFor();
  await shot(tv, "tv-discussion", 900);

  await admin.ok("admin:advancePhase");
  const target = impostors[0]!;
  const voters = alive();
  for (const b of voters.slice(0, 3)) await b.c.ok("player:vote", { targetId: target.id });
  await phone.getByText("Qui éjecter ?").waitFor();
  await phone.locator(".vote-list button", { hasText: target.name }).click();
  await shot(phone, "phone-vote");
  await shot(tv, "tv-vote");
  for (const b of voters.slice(3)) await b.c.ok("player:vote", { targetId: target.id });
  await phone.getByRole("button", { name: "Valider mon vote" }).click();
  await phone.getByRole("button", { name: "Confirmer" }).click();

  await tv.getByText("a été éjecté").waitFor();
  await Promise.all([shot(tv, "tv-result", 5600), shot(phone, "phone-result", 5600)]);

  // Second meeting: the last impostor goes, crew wins.
  await admin.ok("admin:advancePhase");
  await admin.until((v) => v.phase === "PLAYING");
  const desk = await open(browser, `${url}/admin`, DESKTOP, { "amongus.admin": adminToken });
  await desk.getByText("Journal").waitFor();
  await shot(desk, "admin");
  await desk.context().close();

  await admin.ok("admin:callMeeting", {});
  await admin.ok("admin:advancePhase");
  await admin.ok("admin:advancePhase");
  const last = impostors[1] ?? impostors[0]!;
  for (const b of alive()) await b.c.send("player:vote", { targetId: last.id });
  await phone.getByText("Qui éjecter ?").waitFor();
  await phone.locator(".vote-list button", { hasText: last.name }).click();
  await phone.getByRole("button", { name: "Valider mon vote" }).click();
  await phone.getByRole("button", { name: "Confirmer" }).click();

  await phone.getByText("Victoire").first().waitFor();
  await shot(phone, "phone-victory", 1200);
  await tv.getByText("Victoire").first().waitFor({ timeout: 20_000 });
  await shot(tv, "tv-victory", 1500);

  for (const b of bots) b.c.close();
  admin.close();
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
