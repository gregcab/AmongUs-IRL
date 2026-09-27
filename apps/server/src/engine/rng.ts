import { randomBytes, randomInt } from "node:crypto";
import type { Rng } from "./types";

export const cryptoRng: Rng = {
  int: (maxExclusive) => randomInt(maxExclusive),
  id: () => randomBytes(9).toString("base64url"),
};

/** Deterministic generator (mulberry32) for tests and simulations. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  let counter = 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    id: () => `id${++counter}`,
  };
}
