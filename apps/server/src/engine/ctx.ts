import type { ErrorCode, GameError, GameState, Player, ServerEventName, ServerToClientPayloads } from "@among-us/shared";
import { durationMs } from "./state";
import type { OutboundEvent, Recipient, Rng } from "./types";

const LOG_LIMIT = 300;

/** Result of a command handler: an error (state untouched), "noop" (nothing changed) or success. */
export type Outcome = GameError | "noop" | void;

/** Mutable working copy of the state for one command, plus the events it produces. */
export class Ctx {
  readonly events: OutboundEvent[] = [];
  constructor(
    readonly s: GameState,
    readonly now: number,
    readonly rng: Rng,
  ) {}

  emit<N extends ServerEventName>(to: Recipient, name: N, payload: ServerToClientPayloads[N]): void {
    this.events.push({ to, name, payload } as OutboundEvent);
  }

  log(text: string): void {
    this.s.log.push({ at: this.now, text });
    if (this.s.log.length > LOG_LIMIT) this.s.log.splice(0, this.s.log.length - LOG_LIMIT);
  }

  ms(seconds: number): number {
    return durationMs(this.s, seconds);
  }

  player(id: string): Player | undefined {
    return this.s.players[id];
  }
}

export function fail(code: ErrorCode, message: string): GameError {
  return { code, message };
}

export const ALL: Recipient = { group: "all" };
