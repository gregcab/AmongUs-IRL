import { PLAYER_COLORS } from "@among-us/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seededRng, type Rng } from "../src/engine";
import { GameRuntime } from "../src/game";
import { Persistence } from "../src/persistence";

describe("game runtime persistence", () => {
  let dir: string;
  let persistence: Persistence;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    dir = mkdtempSync(join(tmpdir(), "amongus-runtime-"));
    persistence = new Persistence(join(dir, "game.sqlite"));
  });
  afterEach(() => {
    persistence.close();
    rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  const runtime = (rng: Rng = seededRng(1)) => new GameRuntime(persistence, rng, Date.now, 1);
  const join4 = (rt: GameRuntime) => {
    for (let i = 0; i < 4; i++) {
      rt.dispatch({ type: "lobby:join", playerId: `p${i}`, sessionToken: `t${i}`, name: `J${i}`, color: PLAYER_COLORS[i]!.id });
    }
  };

  it("does not journal connection flaps and defers their snapshot", () => {
    const rt = runtime();
    join4(rt);
    rt.dispatch({ type: "system:connection", playerId: "p0", connected: false });
    expect(persistence.journal().map((j) => j.type)).not.toContain("system:connection");
    expect(persistence.loadSnapshot()!.players.p0!.connected).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(persistence.loadSnapshot()!.players.p0!.connected).toBe(false);
    rt.stop();
  });

  it("flushes a deferred snapshot on stop", () => {
    const rt = runtime();
    join4(rt);
    rt.dispatch({ type: "system:connection", playerId: "p1", connected: false });
    rt.stop();
    expect(persistence.loadSnapshot()!.players.p1!.connected).toBe(false);
  });

  it("keeps the journal of the current and the previous game only", () => {
    const rt = runtime();
    join4(rt);
    for (let i = 0; i < 3; i++) {
      rt.dispatch({ type: "admin:start", force: true });
      rt.dispatch({ type: "admin:backToLobby" });
    }
    // A command is journaled under the game id of the state it produced.
    expect(persistence.journal(1000).map((j) => j.type)).toEqual(["admin:backToLobby", "admin:start", "admin:backToLobby"]);
    rt.stop();
  });

  it("survives an exception in the engine", () => {
    const base = seededRng(1);
    let broken = false;
    const rng: Rng = {
      int: (n) => base.int(n),
      id: () => {
        if (broken) throw new Error("boom");
        return base.id();
      },
    };
    const rt = runtime(rng);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    broken = true;
    const before = rt.state;
    const result = rt.dispatch({ type: "admin:renewQrCodes" });
    expect(result.error?.message).toBe("Erreur interne du serveur");
    expect(rt.state).toBe(before);
    expect(errors).toHaveBeenCalled();
    rt.stop();
  });
});
