import {
  KEY_WINDOW_MS,
  SHIELD_CHARGE_MS,
  stationDef,
  TASK_DEFS,
  taskDef,
  taskStations,
  type CoopView,
  type GameError,
  type GameState,
  type Player,
  type PlayerTask,
  type StationId,
  type TaskCategory,
  type TaskProgress,
  type TaskType,
} from "@among-us/shared";
import { fail, type Ctx, type Outcome } from "./ctx";
import { HOLD_TIMEOUT_MS } from "./sabotage";
import { playersInOrder, stationLabel } from "./state";

const SHIELD: StationId = "shield";
const KEYS: readonly StationId[] = ["key-a", "key-b"];

/** Crew task bar: the impostors' fake tasks never count. */
export function crewProgress(s: GameState): TaskProgress {
  let done = 0;
  let total = 0;
  for (const p of Object.values(s.players)) {
    if (p.role !== "crew") continue;
    for (const t of p.tasks ?? []) {
      total++;
      if (t.done) done++;
    }
  }
  return { done, total };
}

/** Task bar as players and the TV may see it, according to `taskBarUpdates`. */
export function visibleTaskBar(s: GameState): TaskProgress | undefined {
  if (s.phase === "LOBBY") return undefined;
  const live = crewProgress(s);
  if (live.total === 0) return undefined;
  if (s.phase === "GAME_OVER") return live;
  switch (s.params.taskBarUpdates) {
    case "always":
      return live;
    case "meetings":
      return s.phase === "MEETING" ? live : (s.taskBarSnapshot ?? { done: 0, total: live.total });
    case "never":
      return undefined;
  }
}

export function tasksAllowed(s: GameState): boolean {
  return s.phase === "PLAYING" || (s.phase === "MEETING" && !s.params.freezeTasksDuringMeeting);
}

function shuffled<T>(c: Ctx, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = c.rng.int(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** Game start: every player draws a list, the impostors a fake one drawn the same way. */
export function drawTasks(c: Ctx): void {
  const s = c.s;
  const pool = (category: TaskCategory) =>
    TASK_DEFS.filter((d) => d.category === category && s.params.enabledTasks.includes(d.type)).map((d): TaskType => d.type);
  // Common tasks are the same for everybody.
  const common = shuffled(c, pool("common")).slice(0, s.params.commonTasks);
  for (const p of playersInOrder(s)) {
    const types = [
      ...common,
      ...shuffled(c, pool("long")).slice(0, s.params.longTasks),
      ...shuffled(c, pool("short")).slice(0, s.params.shortTasks),
    ];
    p.tasks = types.map((type, i): PlayerTask => ({ id: `t${i + 1}`, type, step: 0, done: false }));
  }
  resetCoop(s);
  s.taskBarSnapshot = { done: 0, total: crewProgress(s).total };
}

/** Cooperative stations start over (meetings, end of game). */
export function resetCoop(s: GameState): void {
  s.keyTurns = {};
  s.keyMatchAt = undefined;
  s.shieldChargeStartedAt = undefined;
  s.shieldDoneAt = undefined;
  if (s.holds) delete s.holds[SHIELD];
}

export function clearTasks(s: GameState): void {
  for (const p of Object.values(s.players)) delete p.tasks;
  s.taskBarSnapshot = undefined;
  resetCoop(s);
}

/** Shared by every task action: tasks go on after death (ghosts), never while a body lies there. */
function worker(c: Ctx, playerId: string): Player | GameError {
  if (!tasksAllowed(c.s)) {
    return fail("WRONG_PHASE", c.s.phase === "MEETING" ? "Tâches gelées pendant la réunion" : "La partie n'est pas en cours");
  }
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  if (p.status === "BODY") return fail("NOT_ALLOWED", "Tu es mort : reste sur place");
  return p;
}

function nextStep(c: Ctx, p: Player, task: PlayerTask): void {
  const def = taskDef(task.type);
  task.step += 1;
  if (task.step < def.steps.length) return;
  task.done = true;
  c.log(`${p.name} a terminé « ${def.name} »${p.role === "impostor" ? " (fausse tâche)" : ""}`);
}

/** A mini-game won on the phone: the task's current step must be done at this station. */
export function completeTask(c: Ctx, playerId: string, stationId: StationId, taskId: string): Outcome {
  const p = worker(c, playerId);
  if ("code" in p) return p;
  const task = p.tasks?.find((t) => t.id === taskId);
  if (!task) return fail("BAD_REQUEST", "Tâche inconnue");
  if (task.done) return "noop";
  if (taskDef(task.type).coop) return fail("WRONG_STATION", "Cette tâche se fait à plusieurs");
  const stations = taskStations(task.type, task.step);
  if (!stations.includes(stationId)) {
    return fail("WRONG_STATION", `Cette étape se fait à la station ${stations.map((id) => stationLabel(c.s, id)).join(" ou ")}`);
  }
  nextStep(c, p, task);
}

/** Double key: turns at both key stations by two players within the window. Anybody may help. */
export function keyTurn(c: Ctx, playerId: string, stationId: StationId): Outcome {
  const p = worker(c, playerId);
  if ("code" in p) return p;
  if (!KEYS.includes(stationId)) return fail("WRONG_STATION", "Pas de clé à cette station");
  const turns = (c.s.keyTurns ??= {});
  turns[stationId] = { playerId: p.id, at: c.now };
  const partner = turns[KEYS.find((id) => id !== stationId)!];
  if (!partner || partner.playerId === p.id || c.now - partner.at > KEY_WINDOW_MS) return;
  for (const id of [p.id, partner.playerId]) {
    const q = c.player(id);
    const task = q?.status !== "BODY" ? q?.tasks?.find((t) => t.type === "doubleKey" && !t.done) : undefined;
    if (q && task) nextStep(c, q, task);
  }
  c.s.keyTurns = {};
  c.s.keyMatchAt = c.now;
}

function activeShieldHolders(s: GameState, now: number): string[] {
  return Object.entries(s.holds?.[SHIELD] ?? {})
    .filter(([, until]) => until > now)
    .map(([id]) => id);
}

/** The shield charges while enough players hold the station at the same time. */
export function updateShield(c: Ctx): void {
  const enough = activeShieldHolders(c.s, c.now).length >= (taskDef("shield").coop ?? 3);
  if (!enough) c.s.shieldChargeStartedAt = undefined;
  else c.s.shieldChargeStartedAt ??= c.now;
}

export function shieldHold(c: Ctx, playerId: string, holding: boolean): Outcome {
  const holds = (c.s.holds ??= {});
  if (!holding) {
    if (holds[SHIELD]?.[playerId] === undefined) return "noop";
    delete holds[SHIELD]![playerId];
    updateShield(c);
    return;
  }
  const p = worker(c, playerId);
  if ("code" in p) return p;
  holds[SHIELD] = { ...holds[SHIELD], [p.id]: c.now + HOLD_TIMEOUT_MS };
  updateShield(c);
}

export function shieldCharged(c: Ctx, at: number): Outcome {
  const started = c.s.shieldChargeStartedAt;
  if (started === undefined || started + SHIELD_CHARGE_MS !== at || !tasksAllowed(c.s)) return "noop";
  for (const id of activeShieldHolders(c.s, c.now)) {
    const q = c.player(id);
    const task = q?.tasks?.find((t) => t.type === "shield" && !t.done);
    if (q && task) nextStep(c, q, task);
  }
  c.s.shieldChargeStartedAt = undefined;
  c.s.shieldDoneAt = c.now;
  if (c.s.holds) delete c.s.holds[SHIELD];
}

/** The game master validates a task by hand when a station fails. */
export function adminCompleteTask(c: Ctx, playerId: string, taskId: string): Outcome {
  if (c.s.phase !== "PLAYING" && c.s.phase !== "MEETING") return fail("WRONG_PHASE", "La partie n'est pas en cours");
  const p = c.player(playerId);
  if (!p) return fail("UNKNOWN_PLAYER", "Joueur inconnu");
  const task = p.tasks?.find((t) => t.id === taskId);
  if (!task) return fail("BAD_REQUEST", "Tâche inconnue");
  if (task.done) return "noop";
  task.step = taskDef(task.type).steps.length;
  task.done = true;
  c.log(`Tâche « ${taskDef(task.type).name} » de ${p.name} validée par le MJ`);
}

/** Live state of the cooperative stations, when those tasks are in play. */
export function coopView(s: GameState, now?: number): CoopView | undefined {
  if (!tasksAllowed(s)) return undefined;
  const enabled = s.params.enabledTasks;
  if (!enabled.includes("doubleKey") && !enabled.includes("shield")) return undefined;
  const keyTurns: CoopView["keyTurns"] = {};
  for (const [id, turn] of Object.entries(s.keyTurns ?? {}) as [StationId, { at: number }][]) keyTurns[id] = turn.at;
  return {
    keyTurns,
    keyMatchAt: s.keyMatchAt,
    shieldHolders: now === undefined ? Object.keys(s.holds?.[SHIELD] ?? {}).length : activeShieldHolders(s, now).length,
    shieldChargeStartedAt: s.shieldChargeStartedAt,
    shieldDoneAt: s.shieldDoneAt,
  };
}

export function isTaskStation(id: StationId): boolean {
  return stationDef(id).task !== undefined;
}
