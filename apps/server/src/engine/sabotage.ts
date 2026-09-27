import {
  CRITICAL_SABOTAGES,
  LIGHT_SWITCHES,
  OXYGEN_CODE_STATIONS,
  SABOTAGE_LABEL,
  SABOTAGE_STATIONS,
  type ActiveSabotage,
  type GameState,
  type SabotageKind,
  type StationId,
} from "@among-us/shared";
import { ALL, fail, type Ctx, type Outcome } from "./ctx";
import { isAlive, stationLabel } from "./state";

/** A finger on a station counts for this long unless the phone renews it (heartbeat). */
export const HOLD_TIMEOUT_MS = 4_000;

export function isCritical(kind: SabotageKind): boolean {
  return CRITICAL_SABOTAGES.includes(kind);
}

/** Starts the cooldown shared by the impostors (start of play, after a repair or a meeting). */
export function restartSabotageCooldown(c: Ctx): void {
  c.s.sabotageCooldownEndsAt = c.now + c.ms(c.s.params.sabotageCooldownSeconds);
}

/** Drops the current sabotage and every finger on a station (meetings, end of game). */
export function clearSabotage(s: GameState): void {
  s.sabotage = undefined;
  s.sabotageCooldownEndsAt = undefined;
  s.holds = {};
}

function code(c: Ctx): string {
  return String(c.rng.int(10_000)).padStart(4, "0");
}

export function sabotage(c: Ctx, playerId: string, kind: SabotageKind): Outcome {
  const s = c.s;
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (s.phase !== "PLAYING") return fail("WRONG_PHASE", "Sabotage possible uniquement pendant la partie");
  // Ghost impostors can sabotage too.
  if (p.role !== "impostor") return fail("NOT_ALLOWED", "Action réservée aux imposteurs");
  if (!s.params.enabledSabotages.includes(kind)) return fail("SABOTAGE_UNAVAILABLE", "Ce sabotage est désactivé");
  if (s.sabotage) return fail("SABOTAGE_UNAVAILABLE", "Un sabotage est déjà en cours");
  const readyAt = s.sabotageCooldownEndsAt ?? 0;
  if (c.now < readyAt) return fail("SABOTAGE_UNAVAILABLE", `Sabotage disponible dans ${Math.ceil((readyAt - c.now) / 1000)} s`);

  const active: ActiveSabotage = { id: c.rng.id(), kind, by: p.id, startedAt: c.now };
  if (isCritical(kind)) active.endsAt = c.now + c.ms(s.params.sabotageCriticalSeconds);
  if (kind === "oxygen") {
    const [a, b] = OXYGEN_CODE_STATIONS as [StationId, StationId];
    const codeA = code(c);
    let codeB = code(c);
    while (codeB === codeA) codeB = code(c);
    active.codes = { [a]: codeA, [b]: codeB };
    active.entered = [];
    active.codeReaders = [];
  }
  if (kind === "lights") {
    const switches = Array.from({ length: LIGHT_SWITCHES }, () => c.rng.int(2) === 1);
    while (switches.filter((on) => !on).length < 2) switches[c.rng.int(LIGHT_SWITCHES)] = false;
    active.switches = switches;
  }
  s.sabotage = active;
  // The cooldown restarts once the sabotage is over.
  s.sabotageCooldownEndsAt = undefined;
  c.emit(ALL, "sabotage:started", { kind, endsAt: active.endsAt });
  c.log(`${p.name} a lancé le sabotage ${SABOTAGE_LABEL[kind]}`);
}

function repair(c: Ctx, by: string): void {
  const kind = c.s.sabotage!.kind;
  c.s.sabotage = undefined;
  c.s.holds = {};
  restartSabotageCooldown(c);
  c.emit(ALL, "sabotage:repaired", { kind });
  c.log(`Sabotage ${SABOTAGE_LABEL[kind]} réparé ${by}`);
}

export function adminRepair(c: Ctx): Outcome {
  if (c.s.phase !== "PLAYING" || !c.s.sabotage) return fail("WRONG_PHASE", "Aucun sabotage en cours");
  repair(c, "par le MJ");
}

/** Checks that `playerId` may act at `stationId` to repair a sabotage of kind `kind`. */
function repairer(c: Ctx, playerId: string, stationId: StationId, kind: SabotageKind): Outcome {
  if (c.s.phase !== "PLAYING") return fail("WRONG_PHASE", "La partie n'est pas en cours");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (!SABOTAGE_STATIONS[kind].includes(stationId)) return fail("WRONG_STATION", "Rien à réparer à cette station");
  if (c.s.sabotage?.kind !== kind) return fail("WRONG_STATION", "Rien à réparer ici pour l'instant");
  if (!isAlive(p)) return fail("NOT_ALLOWED", "Les fantômes ne réparent pas les sabotages");
}

/** Reactor: repaired as soon as both reactor stations have a finger on them at the same time. */
export function stationHold(c: Ctx, playerId: string, stationId: StationId, holding: boolean): Outcome {
  const holds = (c.s.holds ??= {});
  if (!holding) {
    if (holds[stationId]?.[playerId] === undefined) return "noop";
    delete holds[stationId]![playerId];
    return;
  }
  const denied = repairer(c, playerId, stationId, "reactor");
  if (denied) return denied;
  // One finger per player: holding a station releases the other one.
  for (const other of SABOTAGE_STATIONS.reactor) if (other !== stationId) delete holds[other]?.[playerId];
  holds[stationId] = { ...holds[stationId], [playerId]: c.now + HOLD_TIMEOUT_MS };
  const held = SABOTAGE_STATIONS.reactor.every((id) => Object.values(holds[id] ?? {}).some((until) => until > c.now));
  if (held) repair(c, "à deux mains");
}

export function holdExpired(c: Ctx, stationId: StationId, playerId: string, until: number): Outcome {
  const holders = c.s.holds?.[stationId];
  if (!holders || holders[playerId] !== until) return "noop";
  delete holders[playerId];
}

/** Oxygen: the code read at the admin station, typed at each O2 station. */
export function stationCode(c: Ctx, playerId: string, stationId: StationId, typed: string): Outcome {
  const denied = repairer(c, playerId, stationId, "oxygen");
  if (denied) return denied;
  const active = c.s.sabotage!;
  const expected = active.codes?.[stationId];
  if (expected === undefined) return fail("WRONG_STATION", `Les codes se lisent à la station ${stationLabel(c.s, "admin")}`);
  if (active.entered?.includes(stationId)) return "noop";
  if (typed.replace(/\D/g, "") !== expected) return fail("WRONG_CODE", "Code incorrect");
  active.entered = [...(active.entered ?? []), stationId];
  c.log(`Code O2 validé à ${stationLabel(c.s, stationId)}`);
  if (OXYGEN_CODE_STATIONS.every((id) => active.entered!.includes(id))) repair(c, "avec les deux codes");
}

/** Lights: every switch of the electrical station back on. */
export function stationSwitch(c: Ctx, playerId: string, stationId: StationId, index: number): Outcome {
  const denied = repairer(c, playerId, stationId, "lights");
  if (denied) return denied;
  const switches = c.s.sabotage!.switches!;
  if (!Number.isInteger(index) || index < 0 || index >= switches.length) return fail("BAD_REQUEST", "Interrupteur inconnu");
  switches[index] = !switches[index];
  if (switches.every(Boolean)) repair(c, "à l'électricité");
}

/** Opening the admin station during an oxygen sabotage reveals the codes to that player. */
export function openStation(c: Ctx, playerId: string, stationId: StationId): Outcome {
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  const active = c.s.sabotage;
  if (c.s.phase !== "PLAYING" || stationId !== "admin" || active?.kind !== "oxygen") return "noop";
  if (active.codeReaders?.includes(p.id)) return "noop";
  active.codeReaders = [...(active.codeReaders ?? []), p.id];
}
