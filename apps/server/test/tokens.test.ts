import { describe, expect, it } from "vitest";
import { AdminAuth } from "../src/auth";
import { Tokens } from "../src/tokens";

describe("body tokens", () => {
  const tokens = new Tokens("secret");
  const rotation = 10;
  const now = 1_700_000_005_000;
  const slot = Tokens.bodySlot(now, rotation);

  it("accepts the current and the previous slot", () => {
    expect(tokens.verifyBody(tokens.bodyToken("g", "p", slot), now, rotation)).toEqual({ gameId: "g", playerId: "p" });
    expect(tokens.verifyBody(tokens.bodyToken("g", "p", slot - 1), now, rotation)).toEqual({ gameId: "g", playerId: "p" });
  });

  it("rejects expired and future slots", () => {
    expect(tokens.verifyBody(tokens.bodyToken("g", "p", slot - 2), now, rotation)).toBeNull();
    expect(tokens.verifyBody(tokens.bodyToken("g", "p", slot + 1), now, rotation)).toBeNull();
  });

  it("rejects forged or tampered tokens", () => {
    const valid = tokens.bodyToken("g", "p", slot);
    const [payload, sig] = valid.split(".") as [string, string];
    expect(tokens.verifyBody(`${payload}.${sig.slice(0, -2)}xx`, now, rotation)).toBeNull();
    const forged = Buffer.from(`B|g|other|${slot}`).toString("base64url");
    expect(tokens.verifyBody(`${forged}.${sig}`, now, rotation)).toBeNull();
    expect(new Tokens("other-secret").verifyBody(valid, now, rotation)).toBeNull();
    expect(tokens.verifyBody("garbage", now, rotation)).toBeNull();
    expect(tokens.verifyBody(42, now, rotation)).toBeNull();
    expect(tokens.verifyBody(tokens.stationToken("g"), now, rotation)).toBeNull();
  });
});

describe("station and admin tokens", () => {
  const tokens = new Tokens("secret");

  it("binds the station token to the game", () => {
    expect(tokens.verifyStation(tokens.stationToken("g1"))).toEqual({ gameId: "g1" });
    expect(tokens.verifyStation(tokens.bodyToken("g1", "p", 1))).toBeNull();
  });

  it("derives admin tokens from the PIN", () => {
    expect(tokens.verifyAdmin(tokens.adminToken("1234"), "1234")).toBe(true);
    expect(tokens.verifyAdmin(tokens.adminToken("1234"), "9999")).toBe(false);
    expect(tokens.verifyAdmin(undefined, "1234")).toBe(false);
  });

  it("locks the admin PIN after repeated failures", () => {
    let now = 0;
    const auth = new AdminAuth("1234", () => now);
    for (let i = 0; i < 5; i++) expect(auth.check("ip", "0000")).toBe("bad");
    expect(auth.check("ip", "1234")).toBe("locked");
    expect(auth.check("other", "1234")).toBe("ok");
    now += 61_000;
    expect(auth.check("ip", "1234")).toBe("ok");
  });
});
