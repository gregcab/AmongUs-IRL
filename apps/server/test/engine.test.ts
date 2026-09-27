import { DEFAULT_PARAMS, resolveImpostorCount, SKIP_VOTE, validateParams } from "@among-us/shared";
import { describe, expect, it } from "vitest";
import { computeEjection, playerView, reduce, timersFromState, tvView } from "../src/engine";
import { Harness } from "./harness";

const FAST = { roleRevealSeconds: 5, deathDelaySeconds: 10, killCooldownSeconds: 30 };

describe("params", () => {
  it("computes the automatic impostor count", () => {
    expect(resolveImpostorCount("auto", 4)).toBe(1);
    expect(resolveImpostorCount("auto", 6)).toBe(1);
    expect(resolveImpostorCount("auto", 7)).toBe(2);
    expect(resolveImpostorCount("auto", 9)).toBe(2);
    expect(resolveImpostorCount("auto", 10)).toBe(3);
    expect(resolveImpostorCount("auto", 15)).toBe(3);
  });

  it("rejects configurations where impostors * 2 >= players", () => {
    expect(resolveImpostorCount(2, 4)).toBeNull();
    expect(resolveImpostorCount(2, 5)).toBe(2);
    expect(resolveImpostorCount("auto", 2)).toBeNull();
  });

  it("validates bounds and types", () => {
    expect(validateParams(DEFAULT_PARAMS, { killCooldownSeconds: 60 }).ok).toBe(true);
    expect(validateParams(DEFAULT_PARAMS, { killCooldownSeconds: 1 }).ok).toBe(false);
    expect(validateParams(DEFAULT_PARAMS, { killCooldownSeconds: 12.5 }).ok).toBe(false);
    expect(validateParams(DEFAULT_PARAMS, { ghostMeetingMode: "nope" }).ok).toBe(false);
    expect(validateParams(DEFAULT_PARAMS, { unknown: 1 }).ok).toBe(false);
    expect(validateParams(DEFAULT_PARAMS, { impostorCount: "auto", confirmEjects: false }).ok).toBe(true);
  });
});

describe("lobby", () => {
  it("enforces unique names (case-insensitive) and colors", () => {
    const h = new Harness();
    h.do({ type: "lobby:join", playerId: "a", sessionToken: "ta", name: "Alice", color: "red" });
    expect(h.try({ type: "lobby:join", playerId: "b", sessionToken: "tb", name: "  alice ", color: "blue" }).error?.code).toBe("NAME_TAKEN");
    expect(h.try({ type: "lobby:join", playerId: "b", sessionToken: "tb", name: "Bob", color: "red" }).error?.code).toBe("COLOR_TAKEN");
    expect(h.try({ type: "lobby:join", playerId: "b", sessionToken: "tb", name: "Bob", color: "chartreuse" }).error?.code).toBe("INVALID_COLOR");
    expect(h.try({ type: "lobby:join", playerId: "b", sessionToken: "tb", name: "", color: "blue" }).error?.code).toBe("INVALID_NAME");
    expect(h.try({ type: "lobby:join", playerId: "b", sessionToken: "tb", name: "x".repeat(17), color: "blue" }).error?.code).toBe("INVALID_NAME");
    h.do({ type: "lobby:join", playerId: "b", sessionToken: "tb", name: "Bob", color: "blue" });
    expect(h.try({ type: "lobby:changeColor", playerId: "b", color: "red" }).error?.code).toBe("COLOR_TAKEN");
    h.do({ type: "lobby:changeColor", playerId: "b", color: "green" });
    expect(h.state.players.b!.color).toBe("green");
  });

  it("rejected commands leave the state object untouched", () => {
    const h = new Harness();
    h.join(1);
    const before = h.state;
    const r = h.try({ type: "lobby:join", playerId: "x", sessionToken: "t", name: "Joueur1", color: "blue" });
    expect(r.error).toBeDefined();
    expect(r.state).toBe(before);
  });

  it("controls the game start", () => {
    const h = new Harness();
    h.join(3);
    expect(h.try({ type: "admin:start" }).error?.code).toBe("NOT_ENOUGH_PLAYERS");
    h.join(0);
    h.do({ type: "lobby:join", playerId: "p4", sessionToken: "t4", name: "Quatre", color: "white" });
    expect(h.try({ type: "admin:start" }).error?.code).toBe("PLAYERS_NOT_READY");
    h.do({ type: "admin:updateParams", params: { impostorCount: 2 } });
    expect(h.try({ type: "admin:start", force: true }).error?.code).toBe("INVALID_IMPOSTOR_COUNT");
    h.do({ type: "admin:updateParams", params: { impostorCount: "auto" } });
    h.do({ type: "admin:start", force: true });
    expect(h.state.phase).toBe("ROLE_REVEAL");
    expect(h.try({ type: "lobby:join", playerId: "p5", sessionToken: "t5", name: "Late", color: "black" }).error?.code).toBe("WRONG_PHASE");
    expect(h.try({ type: "admin:updateParams", params: { killCooldownSeconds: 60 } }).error?.code).toBe("WRONG_PHASE");
  });

  it("kicks players only in the lobby", () => {
    const h = new Harness();
    h.join(2);
    const r = h.do({ type: "admin:kick", playerId: "p1" });
    expect(h.state.players.p1).toBeUndefined();
    expect(r.events.some((e) => e.name === "player:kicked" && "player" in e.to && e.to.player === "p1")).toBe(true);
  });
});

describe("roles", () => {
  it.each([
    [4, 1],
    [7, 2],
    [10, 3],
  ])("deals %i players with %i impostors", (n, k) => {
    const h = new Harness(FAST);
    const { impostors, crew } = h.startGame(n);
    expect(impostors).toHaveLength(k);
    expect(crew).toHaveLength(n - k);
    expect(h.state.phase).toBe("PLAYING");
  });

  it("is reproducible with the same seed and varies with another", () => {
    const deal = (seed: number) => {
      const h = new Harness(FAST, seed);
      return h.startGame(8).impostors.sort().join();
    };
    expect(deal(7)).toBe(deal(7));
    const deals = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(deal));
    expect(deals.size).toBeGreaterThan(1);
  });

  it("sends each role only to its owner and impostor allies only to impostors", () => {
    const h = new Harness(FAST);
    h.join(8);
    for (const id of Object.keys(h.state.players)) h.do({ type: "lobby:ready", playerId: id });
    h.clearEvents();
    h.do({ type: "admin:start" });
    const { impostors } = h.roles();
    const roleEvents = h.events.filter((e) => e.name === "game:role");
    expect(roleEvents).toHaveLength(8);
    for (const e of roleEvents) {
      expect("player" in e.to).toBe(true);
      const owner = (e.to as { player: string }).player;
      const payload = e.payload as { role: string; allies: { id: string }[] };
      expect(payload.role).toBe(h.state.players[owner]!.role);
      if (payload.role === "crew") expect(payload.allies).toEqual([]);
      else expect(payload.allies.map((a) => a.id).sort()).toEqual(impostors.filter((i) => i !== owner).sort());
    }
  });

  it("never leaks roles in broadcast events or in other players' views", () => {
    const h = new Harness({ ...FAST, confirmEjects: false });
    const { impostors, crew } = h.startGame(7);
    h.kill(crew[0]!);
    h.do({ type: "player:reportBody", playerId: crew[1]!, bodyOfId: crew[0]! });
    for (const id of Object.keys(h.state.players)) if (h.status(id) === "ALIVE") h.do({ type: "player:arrived", playerId: id });
    h.do({ type: "admin:advancePhase" });
    for (const id of Object.keys(h.state.players)) if (h.status(id) === "ALIVE") h.do({ type: "player:vote", playerId: id, targetId: impostors[0]! });

    const leaking = h.events.filter((e) => !("player" in e.to) && (e.to as { group: string }).group !== "impostors" && (e.to as { group: string }).group !== "admin" && e.name !== "game:over");
    for (const e of leaking) expect(JSON.stringify(e.payload)).not.toMatch(/"role"|"impostor"|"crew"/);

    const view = playerView(h.state, crew[2]!);
    expect(view.kind).toBe("player");
    expect(JSON.stringify({ ...view, me: undefined })).not.toMatch(/"role"|"impostor"/);
    expect(JSON.stringify(tvView(h.state, "http://x"))).not.toMatch(/"role"|"impostor"/);

    const impView = playerView(h.state, impostors[1]!);
    expect(impView.kind === "player" && impView.allies?.map((a) => a.id)).toEqual([impostors[0]]);
  });

  it("reveals the ejected role on TV only when confirmEjects is on", () => {
    const h = new Harness({ ...FAST, confirmEjects: true });
    const { impostors, crew } = h.startGame(7);
    h.do({ type: "admin:callMeeting" });
    h.do({ type: "admin:advancePhase" });
    h.do({ type: "admin:advancePhase" });
    for (const id of Object.keys(h.state.players)) h.do({ type: "player:vote", playerId: id, targetId: crew[0]! });
    const tv = tvView(h.state, "http://x");
    expect(tv.meeting?.result?.role).toBe("crew");
    expect(JSON.stringify(tv)).not.toContain(impostors[0]! + '","role');
  });
});

describe("kill", () => {
  it("is refused outside PLAYING", () => {
    const h = new Harness(FAST);
    h.join(4);
    expect(h.try({ type: "player:declareDeath", playerId: "p1" }).error?.code).toBe("WRONG_PHASE");
    for (const id of ["p1", "p2", "p3", "p4"]) h.do({ type: "lobby:ready", playerId: id });
    h.do({ type: "admin:start" });
    expect(h.try({ type: "player:declareDeath", playerId: "p1" }).error?.code).toBe("WRONG_PHASE");
    h.seconds(5);
    h.do({ type: "admin:callMeeting" });
    const r = h.try({ type: "player:declareDeath", playerId: "p1" });
    expect(r.error?.code).toBe("WRONG_PHASE");
    expect(r.error?.message).toMatch(/réunion/);
  });

  it("goes DYING then BODY at the deadline, irreversibly", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(6);
    const v = crew[0]!;
    const r = h.do({ type: "player:declareDeath", playerId: v });
    expect(h.status(v)).toBe("DYING");
    expect(r.events.find((e) => e.name === "death:countdown")?.to).toEqual({ player: v });
    expect(r.events.find((e) => e.name === "admin:deathLogged")?.to).toEqual({ group: "admin" });
    expect(r.events.filter((e) => !["death:countdown", "admin:deathLogged"].includes(e.name))).toEqual([]);
    expect(h.try({ type: "player:declareDeath", playerId: v }).error?.code).toBe("NOT_ALLOWED");
    h.seconds(9.9);
    expect(h.status(v)).toBe("DYING");
    h.seconds(0.1);
    expect(h.status(v)).toBe("BODY");
    expect(h.state.timeline).toEqual([{ at: h.now, playerId: v, kind: "death" }]);
  });

  it("restarts the team cooldown on every effective death and notifies impostors only", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(7);
    const start = h.now;
    expect(h.state.killCooldownEndsAt).toBe(start + 30_000);

    h.clearEvents();
    h.kill(crew[0]!); // effective at +10 s
    expect(h.state.killCooldownEndsAt).toBe(start + 10_000 + 30_000);
    const started = h.events.filter((e) => e.name === "kill:cooldownStarted");
    expect(started.map((e) => e.to)).toEqual([{ group: "impostors" }]);

    h.seconds(5);
    h.kill(crew[1]!); // effective at +25 s: restarts to full
    expect(h.state.killCooldownEndsAt).toBe(start + 25_000 + 30_000);

    h.clearEvents();
    h.seconds(29.9);
    expect(h.events.some((e) => e.name === "kill:ready")).toBe(false);
    h.seconds(0.1);
    const ready = h.events.filter((e) => e.name === "kill:ready");
    expect(ready.map((e) => e.to)).toEqual([{ group: "impostors" }]);
    h.seconds(60);
    expect(h.events.filter((e) => e.name === "kill:ready")).toHaveLength(1);
  });

  it("ignores stale ticks", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(6);
    const before = h.state;
    expect(h.try({ type: "tick:deathEffective", playerId: crew[0]!, at: 123 }).state).toBe(before);
    expect(h.try({ type: "tick:phaseEnd", key: "MEETING|old|VOTING" }).state).toBe(before);
    expect(h.try({ type: "tick:killReady", at: 5 }).state).toBe(before);
  });

  it("lets an impostor declare their own death exactly like a crewmate", () => {
    const h = new Harness(FAST);
    const { impostors, crew } = h.startGame(7);
    const a = h.try({ type: "player:declareDeath", playerId: impostors[0]! });
    const b = h.try({ type: "player:declareDeath", playerId: crew[0]! });
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(a.events.map((e) => [e.name, e.to])).toEqual([
      ["death:countdown", { player: impostors[0] }],
      ["admin:deathLogged", { group: "admin" }],
    ]);
    expect(b.events.map((e) => e.name)).toEqual(a.events.map((e) => e.name));
  });
});

describe("body report", () => {
  it("requires a living reporter and a BODY target", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(7);
    const [v, r, other] = crew as [string, string, string];
    h.do({ type: "player:declareDeath", playerId: v });
    expect(h.try({ type: "player:reportBody", playerId: r, bodyOfId: v }).error?.code).toBe("INVALID_TARGET");
    h.seconds(10);
    expect(h.try({ type: "player:reportBody", playerId: r, bodyOfId: other }).error?.code).toBe("INVALID_TARGET");
    expect(h.try({ type: "player:reportBody", playerId: v, bodyOfId: v }).error?.code).toBe("NOT_ALLOWED");
    h.do({ type: "player:declareDeath", playerId: r });
    h.do({ type: "player:reportBody", playerId: r, bodyOfId: v }); // DYING can still report
    expect(h.state.phase).toBe("MEETING");
    expect(h.state.meeting).toMatchObject({ type: "body", reporterId: r, bodyOfId: v, subPhase: "GATHERING" });
  });
});

describe("meeting", () => {
  it("finalizes DYING players and turns every BODY into a GHOST", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(10);
    h.kill(crew[0]!);
    h.do({ type: "player:declareDeath", playerId: crew[1]! });
    h.clearEvents();
    h.do({ type: "player:reportBody", playerId: crew[2]!, bodyOfId: crew[0]! });
    expect(h.status(crew[0]!)).toBe("GHOST");
    expect(h.status(crew[1]!)).toBe("GHOST");
    expect(h.events.find((e) => e.name === "death:confirmed")?.to).toEqual({ player: crew[1] });
    expect(h.events.find((e) => e.name === "meeting:called")?.to).toEqual({ group: "all" });
    expect(h.state.killCooldownEndsAt).toBeUndefined();
    expect(timersFromState(h.state).map((t) => t.id)).toEqual(["phase"]);
  });

  it("moves to discussion when every living player has arrived", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(6);
    h.kill(crew[0]!);
    h.do({ type: "admin:callMeeting", bodyOfId: crew[0]! });
    expect(h.try({ type: "player:arrived", playerId: crew[0]! }).error?.code).toBe("NOT_ALLOWED");
    const alive = Object.keys(h.state.players).filter((id) => h.status(id) === "ALIVE");
    for (const id of alive.slice(0, -1)) h.do({ type: "player:arrived", playerId: id });
    expect(h.state.meeting?.subPhase).toBe("GATHERING");
    h.do({ type: "player:arrived", playerId: alive.at(-1)! });
    expect(h.state.meeting?.subPhase).toBe("DISCUSSION");
  });

  it("times out gathering, discussion and voting", () => {
    const h = new Harness({ ...FAST, gatheringTimeoutSeconds: 20, discussionSeconds: 30, votingSeconds: 40, resumeCountdownSeconds: 5 });
    h.startGame(6);
    h.do({ type: "admin:callMeeting" });
    h.seconds(20);
    expect(h.state.meeting?.subPhase).toBe("DISCUSSION");
    h.seconds(30);
    expect(h.state.meeting?.subPhase).toBe("VOTING");
    h.seconds(40);
    expect(h.state.meeting?.subPhase).toBe("RESULT");
    expect(h.state.meeting?.result).toEqual({ ejectedId: null });
    h.seconds(5);
    expect(h.state.phase).toBe("PLAYING");
  });

  it("computes the ejection by relative majority", () => {
    expect(computeEjection({})).toBeNull();
    expect(computeEjection({ a: "x", b: "x", c: "y" })).toBe("x");
    expect(computeEjection({ a: "x", b: "y" })).toBeNull();
    expect(computeEjection({ a: SKIP_VOTE, b: SKIP_VOTE, c: "y" })).toBeNull();
    expect(computeEjection({ a: SKIP_VOTE, b: "y" })).toBeNull();
    expect(computeEjection({ a: "x", b: "x", c: SKIP_VOTE })).toBe("x");
  });

  it("validates votes, ends early and ejects to GHOST", () => {
    const h = new Harness(FAST);
    const { crew, impostors } = h.startGame(7);
    h.kill(crew[0]!);
    h.do({ type: "admin:callMeeting" });
    h.do({ type: "admin:advancePhase" });
    expect(h.try({ type: "player:vote", playerId: crew[1]!, targetId: crew[2]! }).error?.code).toBe("WRONG_PHASE");
    h.do({ type: "admin:advancePhase" });
    expect(h.try({ type: "player:vote", playerId: crew[0]!, targetId: crew[2]! }).error?.code).toBe("NOT_ALLOWED");
    expect(h.try({ type: "player:vote", playerId: crew[1]!, targetId: crew[0]! }).error?.code).toBe("INVALID_TARGET");
    h.clearEvents();
    h.do({ type: "player:vote", playerId: crew[1]!, targetId: crew[2]! });
    expect(h.events).toEqual([{ to: { group: "all" }, name: "meeting:voteCast", payload: { voterId: crew[1] } }]);
    expect(h.try({ type: "player:vote", playerId: crew[1]!, targetId: SKIP_VOTE }).error?.code).toBe("ALREADY_VOTED");

    const voters = Object.keys(h.state.players).filter((id) => h.status(id) === "ALIVE" && id !== crew[1]);
    for (const id of voters) h.do({ type: "player:vote", playerId: id, targetId: crew[2]! });
    expect(h.state.meeting?.subPhase).toBe("RESULT");
    expect(h.status(crew[2]!)).toBe("GHOST");
    expect(h.state.players[crew[2]!]!.ejected).toBe(true);
    expect(impostors).toHaveLength(2);
  });

  it("counts missing votes as no vote", () => {
    const h = new Harness({ ...FAST, votingSeconds: 10 });
    const { crew } = h.startGame(7);
    h.do({ type: "admin:callMeeting" });
    h.do({ type: "admin:advancePhase" });
    h.do({ type: "admin:advancePhase" });
    h.do({ type: "player:vote", playerId: crew[0]!, targetId: crew[1]! });
    h.seconds(10);
    expect(h.state.meeting?.result?.ejectedId).toBe(crew[1]);
  });

  it("restarts both cooldowns at full value when play resumes", () => {
    const h = new Harness({ ...FAST, emergencyCooldownSeconds: 20, resumeCountdownSeconds: 10 });
    h.startGame(6);
    h.seconds(12);
    h.do({ type: "admin:callMeeting" });
    for (let i = 0; i < 3; i++) h.do({ type: "admin:advancePhase" });
    expect(h.state.meeting?.subPhase).toBe("RESULT");
    h.seconds(10);
    expect(h.state.phase).toBe("PLAYING");
    expect(h.state.killCooldownEndsAt).toBe(h.now + 30_000);
    expect(h.state.emergencyCooldownEndsAt).toBe(h.now + 20_000);
    expect(h.state.meetingHistory).toHaveLength(1);
  });

  it("enforces emergency quota and cooldown", () => {
    const h = new Harness({ ...FAST, emergencyCooldownSeconds: 30, emergencyMeetingsPerPlayer: 1 });
    const { crew } = h.startGame(6);
    h.seconds(18);
    const early = h.try({ type: "player:emergency", playerId: crew[0]! });
    expect(early.error).toEqual({ code: "EMERGENCY_COOLDOWN", message: "Bouton disponible dans 12 s" });
    h.seconds(12);
    h.do({ type: "player:emergency", playerId: crew[0]! });
    expect(h.state.meeting?.type).toBe("emergency");
    for (let i = 0; i < 4; i++) h.do({ type: "admin:advancePhase" });
    h.seconds(30);
    expect(h.try({ type: "player:emergency", playerId: crew[0]! }).error?.code).toBe("EMERGENCY_QUOTA");
    h.do({ type: "player:emergency", playerId: crew[1]! });
  });

  it("does not let ghosts vote or report", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(7);
    h.kill(crew[0]!);
    h.do({ type: "admin:callMeeting" });
    for (let i = 0; i < 4; i++) h.do({ type: "admin:advancePhase" });
    h.seconds(60);
    expect(h.try({ type: "player:emergency", playerId: crew[0]! }).error?.code).toBe("NOT_ALLOWED");
    h.kill(crew[1]!);
    expect(h.try({ type: "player:reportBody", playerId: crew[0]!, bodyOfId: crew[1]! }).error?.code).toBe("NOT_ALLOWED");
  });
});

describe("victory", () => {
  it("gives impostors the win after an effective death reaching parity", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(4); // 1 impostor, 3 crew
    h.kill(crew[0]!);
    expect(h.state.phase).toBe("PLAYING");
    h.do({ type: "player:declareDeath", playerId: crew[1]! });
    expect(h.state.phase).toBe("PLAYING"); // DYING still counts as alive
    h.seconds(10);
    expect(h.state.phase).toBe("GAME_OVER");
    expect(h.state.winner).toBe("impostors");
  });

  it("gives impostors the win when a meeting finalizes a DYING player", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(4);
    h.kill(crew[0]!);
    h.do({ type: "player:declareDeath", playerId: crew[1]! });
    h.clearEvents();
    h.do({ type: "player:reportBody", playerId: crew[2]!, bodyOfId: crew[0]! });
    expect(h.state.phase).toBe("GAME_OVER");
    expect(h.state.winner).toBe("impostors");
    const names = h.events.map((e) => e.name);
    expect(names.indexOf("meeting:called")).toBeLessThan(names.indexOf("game:over"));
  });

  it("gives crew the win when the last impostor is ejected", () => {
    const h = new Harness(FAST);
    const { impostors } = h.startGame(5);
    h.do({ type: "admin:callMeeting" });
    h.do({ type: "admin:advancePhase" });
    h.do({ type: "admin:advancePhase" });
    for (const id of Object.keys(h.state.players)) h.do({ type: "player:vote", playerId: id, targetId: impostors[0]! });
    expect(h.state.phase).toBe("GAME_OVER");
    expect(h.state.winner).toBe("crew");
    const info = playerView(h.state, impostors[0]!).gameOver;
    expect(info?.roles.find((r) => r.id === impostors[0])?.role).toBe("impostor");
    expect(info?.timeline).toEqual([{ at: h.now, playerId: impostors[0], kind: "ejection" }]);
  });

  it("gives impostors the win after ejecting a crewmate at parity", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(5); // 1 impostor + 4 crew
    h.kill(crew[0]!);
    h.kill(crew[1]!);
    h.do({ type: "admin:callMeeting" });
    h.do({ type: "admin:advancePhase" });
    h.do({ type: "admin:advancePhase" });
    for (const id of Object.keys(h.state.players)) if (h.status(id) === "ALIVE") h.do({ type: "player:vote", playerId: id, targetId: crew[2]! });
    expect(h.state.winner).toBe("impostors");
  });
});

describe("admin", () => {
  it("declares deaths, revives, ends and returns to lobby", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(7);
    h.do({ type: "admin:declareDeath", playerId: crew[0]! });
    expect(h.status(crew[0]!)).toBe("BODY");
    h.do({ type: "admin:revive", playerId: crew[0]! });
    expect(h.status(crew[0]!)).toBe("ALIVE");

    h.do({ type: "admin:callMeeting" });
    h.do({ type: "admin:advancePhase" });
    h.do({ type: "admin:advancePhase" });
    for (const id of Object.keys(h.state.players)) h.do({ type: "player:vote", playerId: id, targetId: crew[1]! });
    expect(h.try({ type: "admin:revive", playerId: crew[1]! }).error?.code).toBe("NOT_ALLOWED");

    const gameId = h.state.gameId;
    h.do({ type: "admin:endGame", winner: "crew" });
    expect(h.state.phase).toBe("GAME_OVER");
    h.do({ type: "admin:backToLobby" });
    expect(h.state.phase).toBe("LOBBY");
    expect(h.state.gameId).not.toBe(gameId);
    expect(Object.values(h.state.players).every((p) => !p.ready && p.role === undefined && p.status === "ALIVE")).toBe(true);
  });

  it("aborts a running game back to the lobby, cancelling every timer", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(6);
    h.do({ type: "player:declareDeath", playerId: crew[0]! });
    expect(timersFromState(h.state).length).toBeGreaterThan(0);
    h.do({ type: "admin:backToLobby" });
    expect(h.state.phase).toBe("LOBBY");
    expect(timersFromState(h.state)).toEqual([]);
    expect(h.state.log.at(-1)?.text).toMatch(/annulée/);
    expect(h.try({ type: "admin:backToLobby" }).error?.code).toBe("WRONG_PHASE");
  });

  it("removes a player killed by the admin during a meeting from the vote", () => {
    const h = new Harness(FAST);
    const { crew } = h.startGame(7);
    h.do({ type: "admin:callMeeting" });
    h.do({ type: "admin:advancePhase" });
    h.do({ type: "admin:advancePhase" });
    const alive = Object.keys(h.state.players).filter((id) => id !== crew[0]);
    for (const id of alive) h.do({ type: "player:vote", playerId: id, targetId: SKIP_VOTE });
    expect(h.state.meeting?.subPhase).toBe("VOTING");
    h.do({ type: "admin:declareDeath", playerId: crew[0]! });
    expect(h.state.meeting?.subPhase).toBe("RESULT");
  });

  it("is pure: reduce never mutates its input", () => {
    const h = new Harness(FAST);
    h.startGame(6);
    const snapshot = JSON.stringify(h.state);
    reduce(h.state, { type: "admin:callMeeting" }, h.now, h.rng);
    expect(JSON.stringify(h.state)).toBe(snapshot);
  });
});
