# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This repository currently contains only [SPEC.md](SPEC.md) — no code has been written yet. SPEC.md is the full implementation spec (in French) for the MVP and is the source of truth for architecture, event contracts, and data model. Read it before implementing anything; the summary below is a navigation aid, not a replacement.

**Language convention**: code, identifiers, and event names are in English. Text shown to players (UI strings) is in French.

## What this is

"Among Us IRL": a local web app (Docker, mini-PC or Raspberry Pi 5) that referees a real-life, phone-based game of Among Us. No internet access — local Wi-Fi only, plain HTTP (no TLS). Three views:

- **Player** (`/`) — phone, portrait.
- **TV** (`/tv`) — shared screen, landscape, no interaction.
- **Admin/game-master console** (`/admin`) — PIN-protected, sees all roles, arbitrates but does not play.

## Planned architecture (per SPEC.md §4)

pnpm workspaces monorepo, TypeScript strict, Node 22:

```
packages/shared/src/   types.ts, params.ts, events.ts   — shared types & event contracts
apps/server/src/
  engine/              pure deterministic game engine (see below)
  scheduler.ts         timers → "tick" commands into the engine
  transport/           Socket.IO, REST routes, rooms
  auth.ts              player sessions, admin PIN
  tokens.ts            HMAC-signed rotating QR tokens
  persistence.ts       SQLite: event journal + snapshot
  index.ts
apps/web/src/           Vite + React, single app, three routes (player/tv/admin)
```

- **Server**: Fastify + Socket.IO, also serves the built frontend static assets.
- **Persistence**: SQLite (`better-sqlite3`), file in a Docker volume. No Redis, no reverse proxy in the MVP — single process, single node.
- **Tests**: Vitest.

### Core engine pattern (central to this codebase)

Game state lives in memory in a single server process. The core is a **pure, deterministic reducer**, testable without network or real clocks:

```ts
reduce(state: GameState, command: Command, now: number, rng: Rng)
  → { state: GameState; events: OutboundEvent[]; timers: TimerRequest[] }
```

- `command` comes from a client (`player:*`, `admin:*`) or from the scheduler (`tick:*`).
- `events` are addressed to a recipient: one player, a group (impostors/ghosts/alive), the TV, the admin, or everyone.
- `timers` ask the scheduler to call the engine back at a deadline (e.g. `tick:deathEffective`, `tick:phaseEnd`, `tick:killReady`), each with an id so it can be cancelled/ignored if stale.
- `rng` is injected — deterministic in tests, `crypto.randomInt` in production.

Every accepted command is appended to the SQLite journal, and full state is snapshotted as JSON. On restart, the server reloads the last snapshot and reschedules timers from the deadlines stored in state. Any command received outside its valid phase must be rejected with a typed error and no side effects — this is load-bearing for the anti-cheat model.

### Phase/status state machines (SPEC.md §5)

```
LOBBY → ROLE_REVEAL → PLAYING ⇄ MEETING → … → GAME_OVER → (LOBBY via "replay")
MEETING = GATHERING → DISCUSSION → VOTING → RESULT
```

Player status: `ALIVE → DYING → BODY → GHOST` (or `ALIVE → GHOST` on ejection). `DYING` still counts as alive for win conditions and for other players; only `BODY`/`GHOST` count as dead.

### Realtime contract (SPEC.md §8)

Socket.IO rooms: `player:<id>`, `alive`, `impostors`, `ghosts`, `tv`, `admin`, recomputed on every status change. **Role information only ever flows through `player:<id>`, `impostors`, and `admin`** — the TV is never authenticated as a player and never receives role info before `GAME_OVER`. `state:sync` is the client-side source of truth: every view must be able to fully reconstruct itself from it, on any (re)connection.

## Security model (SPEC.md §11)

Server is authoritative — clients are trusted only for stated intent, never for state. QR tokens are HMAC-SHA256 signed, checked in constant time. Response timing/behavior must be identical for crew and impostors on all shared actions (no side-channel role leaks). No sound on the victim's phone at kill time, nor on the impostor's phone at `kill:ready`.

## Mobile browser constraints (SPEC.md §12)

The server is plain HTTP on the LAN, which limits some web APIs:
- Wake Lock API only works in a secure context — use it when available, otherwise fall back to a muted looping video (NoSleep.js technique). Critical for the body's QR screen.
- Vibration API doesn't exist on iOS Safari — always pair vibration with a visual fallback.
- Audio only unlocks after a user gesture (the "I'm ready" button plays a short sound; preload the alarm sound).
- No `crypto.randomUUID`/`crypto.subtle` client-side (insecure context) — IDs and signatures are generated server-side only.
- The device camera app may open a different browser than the one the player joined with — `/r/:token` and `/e/:token` must handle "no session in this browser" gracefully.

## Docker

MVP dev iterates without Docker (faster: no image rebuild per change) — run server/web directly with Node 22 + pnpm. Docker (Dockerfile, docker-compose, env vars per §4) stays the target for final deployment on the Pi/mini-PC: reintroduce it before the real event, since it's what makes the deploy reproducible (native `better-sqlite3` build for ARM, env config, restart behavior) rather than hand-configured on the Pi.

## Dev workflow (SPEC.md §13, once scaffolded)

- `?dev=1` URL param stores the session in `sessionStorage` instead of `localStorage`, so multiple players can be opened in tabs of the same browser.
- `pnpm simulate --players 8` — automated Socket.IO clients that join, ready up, and run a scenario (kill, report, vote) to test without physical phones.
- Optional dev-only time accelerator (multiplies durations).

## Implementation plan (SPEC.md §16)

Build in this order, keeping the project working and tested after each step: 1) monorepo/shared/server skeleton + Docker + health route, 2) pure engine + unit tests, 3) transport (Socket.IO/REST/sessions/admin auth), 4) SQLite persistence + restart recovery, 5) player view, 6) TV view, 7) admin console + printable emergency QR, 8) mobile constraints (§12) + simulation script. Run tests and verify the Docker build after each step.

## Out of scope for MVP

Tasks/chores (deferred — only extension points are reserved, see SPEC.md §15: a `Station` entity, `/s/:token` prefix, a slot in `state:sync`, a pluggable task win condition, the `freezeTasksDuringMeeting` param), sabotage/minigames, ESP32/MQTT hardware, killer self-ID by victim, game pause, cross-game stats.
