import { ADMIN_COOKIE, PLAYER_COLORS, SESSION_HEADER, type ClientView, type PlayerView } from "@among-us/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app";
import type { Config } from "../src/config";
import { seededRng } from "../src/engine";
import { TestClient } from "./client";

const PIN = "4242";

function makeConfig(dataDir: string): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    publicUrl: "http://game.test",
    adminPin: PIN,
    hmacSecret: "test-secret",
    dataDir,
    webDist: join(dataDir, "no-web"),
    timeScale: 0.01,
    dev: true,
  };
}

const asPlayer = (v: ClientView): PlayerView => {
  if (v.kind !== "player") throw new Error(`expected player view, got ${v.kind}`);
  return v;
};

describe("server integration", () => {
  let dir: string;
  let app: App;
  let url: string;
  const clients: TestClient[] = [];

  async function boot(seed = 3): Promise<void> {
    app = await createApp(makeConfig(dir), { rng: seededRng(seed), dbFile: join(dir, "game.sqlite") });
    const port = await app.listen();
    url = `http://127.0.0.1:${port}`;
  }

  async function client(auth: Record<string, unknown> = {}): Promise<TestClient> {
    const c = new TestClient(url, auth);
    clients.push(c);
    await c.connected();
    await c.until(() => true);
    return c;
  }

  async function admin(): Promise<TestClient> {
    const c = await client();
    await c.ok("admin:auth", { pin: PIN });
    await c.until((v) => v.kind === "admin");
    return c;
  }

  async function players(n: number): Promise<{ c: TestClient; id: string; token: string }[]> {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = await client();
      const data = await c.ok<{ token: string }>("lobby:join", { name: `P${i}`, color: PLAYER_COLORS[i]!.id });
      const v = asPlayer(await c.until((v) => v.kind === "player"));
      out.push({ c, id: v.me.id, token: data!.token });
    }
    return out;
  }

  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { ok: boolean; error?: { code: string; message: string } } };
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "amongus-"));
    await boot();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves a health route", async () => {
    const res = await fetch(`${url}/api/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("joins, then resumes the session on reconnection", async () => {
    const [p] = await players(1);
    expect(asPlayer(p!.c.view!).me.name).toBe("P0");
    p!.c.close();
    const again = await client({ sessionToken: p!.token });
    const v = asPlayer(await again.until((v) => v.kind === "player"));
    expect(v.me.id).toBe(p!.id);
    const unknown = await client({ sessionToken: "nope" });
    expect(unknown.view?.kind).toBe("anonymous");
  });

  it("guards admin commands and rate-limits the PIN", async () => {
    const [p] = await players(1);
    const res = await p!.c.send("admin:start", {});
    expect(res.ok).toBe(false);
    const c = await client();
    for (let i = 0; i < 5; i++) expect((await c.send("admin:auth", { pin: "0000" })).ok).toBe(false);
    const locked = await c.send("admin:auth", { pin: PIN });
    expect(!locked.ok && locked.error.code).toBe("RATE_LIMITED");
  });

  it("plays a kill, a body report by QR and a vote end to end", async () => {
    const ps = await players(5);
    const mj = await admin();
    const tv = await client({ tv: true });
    for (const p of ps) await p.c.ok("lobby:ready");
    await mj.ok("admin:start", {});
    for (const p of ps) await p.c.until((v) => v.phase === "PLAYING", 3000);

    const roleOf = (p: (typeof ps)[number]) => asPlayer(p.c.view!).me.role;
    const crew = ps.filter((p) => roleOf(p) === "crew");
    const impostor = ps.find((p) => roleOf(p) === "impostor")!;
    expect(crew).toHaveLength(4);
    expect(asPlayer(impostor.c.view!).killCooldownEndsAt).toBeTypeOf("number");
    expect(asPlayer(crew[0]!.c.view!).killCooldownEndsAt).toBeUndefined();

    // Kill: the victim holds "I'm dead", becomes a body and receives a rotating QR.
    const [victim, reporter] = crew as [(typeof ps)[number], (typeof ps)[number]];
    await victim.c.ok("player:declareDeath");
    await victim.c.until((v) => asPlayer(v).me.status === "BODY");
    const qr = await victim.c.event("body:qr");
    expect(qr.url).toBe(`http://game.test/r/${qr.token}`);
    expect(asPlayer(reporter.c.view!).players.find((p) => p.id === victim.id)?.dead).toBe(false);
    expect(impostor.c.events.some((e) => e.name === "kill:cooldownStarted")).toBe(true);
    expect(reporter.c.events.some((e) => e.name.startsWith("kill:"))).toBe(false);

    // Report via REST, as opened by the phone camera.
    expect((await post("/api/report", { token: qr.token })).status).toBe(401);
    expect((await post("/api/report", { token: "forged.token" }, { [SESSION_HEADER]: reporter.token })).status).toBe(400);
    const report = await post("/api/report", { token: qr.token }, { [SESSION_HEADER]: reporter.token });
    expect(report).toEqual({ status: 200, body: { ok: true } });
    const again = await post("/api/report", { token: qr.token }, { [SESSION_HEADER]: reporter.token });
    expect(again.status).toBe(409);

    const called = await tv.event("meeting:called");
    expect(called).toMatchObject({ type: "body", reporterId: reporter.id, bodyOfId: victim.id, ghostMode: "cemetery" });
    await victim.c.until((v) => asPlayer(v).me.status === "GHOST");
    expect(JSON.stringify(tv.view)).not.toMatch(/"role"|"impostor"/);

    // Gathering → discussion → vote against the impostor.
    const alive = ps.filter((p) => p !== victim);
    for (const p of alive) await p.c.ok("player:arrived");
    await tv.until((v) => v.meeting?.subPhase === "DISCUSSION");
    await mj.ok("admin:advancePhase");
    for (const p of alive) await p.c.ok("player:vote", { targetId: impostor.id });
    const over = await tv.until((v) => v.phase === "GAME_OVER");
    expect(over.gameOver?.winner).toBe("crew");
    expect(over.gameOver?.roles.find((r) => r.id === impostor.id)?.role).toBe("impostor");
  });

  it("reports a body by typing its short code, with a lockout on wrong guesses", async () => {
    const ps = await players(5);
    const mj = await admin();
    for (const p of ps) await p.c.ok("lobby:ready");
    await mj.ok("admin:updateParams", { params: { deathDelaySeconds: 0 } });
    await mj.ok("admin:start", {});
    for (const p of ps) await p.c.until((v) => v.phase === "PLAYING", 3000);
    const crew = ps.filter((p) => asPlayer(p.c.view!).me.role === "crew");
    const [victim, reporter, guesser] = crew as [(typeof ps)[number], (typeof ps)[number], (typeof ps)[number]];

    await victim.c.ok("player:declareDeath");
    const qr = await victim.c.event("body:qr");
    expect(qr.code).toMatch(/^\d{4}$/);

    const wrong = String((Number(qr.code) + 1) % 10000).padStart(4, "0");
    for (let i = 0; i < 5; i++) {
      const res = await guesser.c.send("player:reportCode", { code: wrong });
      expect(!res.ok && res.error.code).toBe("INVALID_TOKEN");
    }
    const locked = await guesser.c.send("player:reportCode", { code: qr.code });
    expect(!locked.ok && locked.error.code).toBe("RATE_LIMITED");

    await reporter.c.ok("player:reportCode", { code: ` ${qr.code.slice(0, 2)} ${qr.code.slice(2)} ` });
    await reporter.c.until((v) => v.phase === "MEETING");
    expect(reporter.c.events.find((e) => e.name === "meeting:called")?.payload).toMatchObject({ type: "body", reporterId: reporter.id, bodyOfId: victim.id });
    const during = await reporter.c.send("player:reportCode", { code: qr.code });
    expect(!during.ok && during.error.message).toMatch(/réunion/);
  });

  it("handles emergency meetings through the printed station token", async () => {
    const ps = await players(4);
    const mj = await admin();
    for (const p of ps) await p.c.ok("lobby:ready");
    const view = await mj.until((v) => v.kind === "admin");
    const stationToken = view.kind === "admin" ? view.emergencyUrl.split("/e/")[1]! : "";

    await mj.ok("admin:updateParams", { params: { emergencyCooldownSeconds: 0 } });
    await mj.ok("admin:start", {});
    await ps[0]!.c.until((v) => v.phase === "PLAYING", 3000);

    const wrongGame = app.tokens.emergencyToken("another-game");
    expect((await post("/api/emergency", { token: wrongGame }, { [SESSION_HEADER]: ps[0]!.token })).status).toBe(400);
    const res = await post("/api/emergency", { token: stationToken }, { cookie: `amongus_session=${ps[0]!.token}` });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    await ps[1]!.c.until((v) => v.phase === "MEETING");
    expect(ps[1]!.c.events.find((e) => e.name === "meeting:called")?.payload).toMatchObject({ type: "emergency", reporterId: ps[0]!.id });
  });

  it("checks the lobby scan practice from the TV's QR code", async () => {
    const [p0, p1] = await players(2);
    const tv = await client({ tv: true });
    const tvView = await tv.until((v) => v.kind === "tv" && v.practiceUrl !== undefined);
    const practiceToken = tvView.kind === "tv" ? tvView.practiceUrl!.split("/t/")[1]! : "";
    expect(tvView.kind === "tv" && tvView.practiceUrl).toBe(`http://game.test/t/${practiceToken}`);

    const noSession = await post("/api/practice", { token: practiceToken });
    expect(noSession.status).toBe(401);
    expect(noSession.body.error?.message).toMatch(/navigateur avec lequel vous avez rejoint/);
    const oldGame = await post("/api/practice", { token: app.tokens.practiceToken("old-game") }, { [SESSION_HEADER]: p0!.token });
    expect(oldGame.status).toBe(400);
    expect(await post("/api/practice", { token: practiceToken }, { cookie: `amongus_session=${p0!.token}` })).toEqual({ status: 200, body: { ok: true } });

    await tv.until((v) => v.players.find((p) => p.id === p0!.id)?.scanOk === true);
    const mine = asPlayer(await p1!.c.until((v) => v.players.some((p) => p.scanOk)));
    expect(mine.players.map((p) => p.scanOk)).toEqual([true, false]);
  });

  it("opens stations by QR token or printed code and repairs a sabotage", async () => {
    const ps = await players(5);
    const mj = await admin();
    for (const p of ps) await p.c.ok("lobby:ready");
    await mj.ok("admin:updateParams", { params: { sabotageCooldownSeconds: 5 } });
    const stations = app.transport.printableStations();
    expect(stations.map((st) => st.id)).toEqual(["reactor-a", "reactor-b", "o2-a", "o2-b", "admin", "electrical"]);
    expect(new Set(stations.map((st) => st.code)).size).toBe(stations.length);
    const at = (id: string) => ({ token: stations.find((st) => st.id === id)!.url.split("/s/")[1]! });
    const codeOf = (id: string) => stations.find((st) => st.id === id)!.code;

    await mj.ok("admin:start", {});
    for (const p of ps) await p.c.until((v) => v.phase === "PLAYING", 3000);
    const impostor = ps.find((p) => asPlayer(p.c.view!).me.role === "impostor")!;
    const crew = ps.filter((p) => p !== impostor);

    expect(await crew[0]!.c.ok("station:open", { at: at("admin") })).toEqual({ stationId: "admin" });
    expect(await crew[0]!.c.ok("station:open", { at: { code: codeOf("o2-b") } })).toEqual({ stationId: "o2-b" });
    const forged = await crew[0]!.c.send("station:open", { at: { token: app.tokens.stationToken("old-game", "admin") } });
    expect(!forged.ok && forged.error.message).toMatch(/périmé/);

    await impostor.c.until((v) => (asPlayer(v).sabotageCooldownEndsAt ?? Infinity) <= Date.now(), 3000);
    await impostor.c.ok("player:sabotage", { kind: "oxygen" });
    await crew[1]!.c.event("sabotage:started");
    await crew[0]!.c.ok("station:open", { at: at("admin") });
    const codes = asPlayer(await crew[0]!.c.until((v) => asPlayer(v).sabotage?.codes !== undefined)).sabotage!.codes!;
    expect(asPlayer(crew[1]!.c.view!).sabotage?.codes).toBeUndefined();
    await crew[0]!.c.ok("station:code", { at: at("o2-a"), code: codes["o2-a"] });
    await crew[1]!.c.ok("station:code", { at: { code: codeOf("o2-b") }, code: codes["o2-b"] });
    await crew[2]!.c.event("sabotage:repaired");
    expect(crew[2]!.c.view?.sabotage).toBeUndefined();

    // Wrong station codes lock the player out for a while.
    for (let i = 0; i < 5; i++) await crew[3]!.c.send("station:open", { at: { code: "abcd" } });
    const locked = await crew[3]!.c.send("station:open", { at: { code: codeOf("admin") } });
    expect(!locked.ok && locked.error.code).toBe("RATE_LIMITED");
  });

  it("serves the printable stations page to the admin only", async () => {
    expect((await fetch(`${url}/api/print/stations`)).status).toBe(401);
    const res = await fetch(`${url}/api/print/stations`, { headers: { cookie: `${ADMIN_COOKIE}=${app.tokens.adminToken(PIN)}` } });
    const html = await res.text();
    expect(html.match(/<svg/g)).toHaveLength(6);
    expect(html).toContain("Électricité");
  });

  it("serves the printable emergency page to the admin only", async () => {
    expect((await fetch(`${url}/api/print/emergency`)).status).toBe(401);
    const res = await fetch(`${url}/api/print/emergency`, { headers: { cookie: `${ADMIN_COOKIE}=${app.tokens.adminToken(PIN)}` } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<svg");
  });

  it("upgrades a snapshot saved before new parameters existed", async () => {
    await players(1);
    const saved = structuredClone(app.runtime.state) as unknown as { params: Record<string, unknown> };
    delete saved.params.enabledSabotages;
    delete saved.params.sabotageCooldownSeconds;
    app.persistence.saveSnapshot(saved as never, Date.now());
    for (const c of clients.splice(0)) c.close();
    await app.close();
    await boot();
    expect(app.runtime.state.params.enabledSabotages).toEqual(["reactor", "oxygen", "lights"]);
    expect(app.runtime.state.params.sabotageCooldownSeconds).toBe(90);
    const tv = await client({ tv: true });
    expect((await tv.until((v) => v.kind === "tv")).stations).toHaveLength(6);
  });

  it("restores state, sessions and timers after a restart", async () => {
    const ps = await players(4);
    const mj = await admin();
    await mj.ok("admin:updateParams", { params: { roleRevealSeconds: 120 } });
    await mj.ok("admin:start", { force: true });
    await ps[0]!.c.until((v) => v.phase === "ROLE_REVEAL");
    const before = app.runtime.state;

    for (const c of clients.splice(0)) c.close();
    await app.close();
    await boot(99);

    expect(app.runtime.state.gameId).toBe(before.gameId);
    expect(app.runtime.state.phase).toBe("ROLE_REVEAL");
    expect(Object.values(app.runtime.state.players).map((p) => p.role)).toEqual(Object.values(before.players).map((p) => p.role));
    expect(app.runtime.pendingTimers()).toEqual([{ id: "phase", at: before.phaseEndsAt }]);

    const back = await client({ sessionToken: ps[2]!.token });
    const v = asPlayer(await back.until((v) => v.kind === "player"));
    expect(v.me.role).toBe(before.players[ps[2]!.id]!.role);
    expect(app.persistence.journal().some((j) => j.type === "admin:start")).toBe(true);
  });
});
