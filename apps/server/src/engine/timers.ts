import type { GameState } from "@among-us/shared";
import { phaseKey } from "./state";
import type { TimerRequest } from "./types";

/**
 * Timers are derived from state alone, so a restarted server reschedules them from the
 * snapshot exactly as the engine would have requested.
 */
export function timersFromState(s: GameState): TimerRequest[] {
  const timers: TimerRequest[] = [];
  if (s.phaseEndsAt !== undefined && (s.phase === "ROLE_REVEAL" || s.phase === "MEETING")) {
    timers.push({ id: "phase", at: s.phaseEndsAt, command: { type: "tick:phaseEnd", key: phaseKey(s) } });
  }
  if (s.phase === "PLAYING") {
    for (const p of Object.values(s.players)) {
      if (p.status === "DYING" && p.dyingEffectiveAt !== undefined) {
        timers.push({
          id: `death:${p.id}`,
          at: p.dyingEffectiveAt,
          command: { type: "tick:deathEffective", playerId: p.id, at: p.dyingEffectiveAt },
        });
      }
    }
    if (s.killCooldownEndsAt !== undefined && !s.killReadyNotified) {
      timers.push({ id: "killReady", at: s.killCooldownEndsAt, command: { type: "tick:killReady", at: s.killCooldownEndsAt } });
    }
  }
  return timers;
}
