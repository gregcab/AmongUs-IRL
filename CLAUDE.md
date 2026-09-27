# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Among Us IRL": a local web app (mini-PC or Raspberry Pi 5) that referees a real-life, phone-based game of Among Us. Local Wi-Fi only, plain HTTP (no TLS). [SPEC.md](SPEC.md) (in French) is the source of truth for rules, event contracts and data model — read the relevant section before changing game behavior.

Three views, one React app: player (`/`, phone portrait), TV (`/tv`, no interaction), game-master console (`/admin`, PIN-protected; the GM sees all roles and does not play). QR scan landing pages: `/r/:token` (body report), `/e/:token` (emergency station); `/s/:token` is reserved for future tasks.

**Language convention**: code, identifiers and event names in English; every player-facing string in French.

## Commands

Requires Node ≥ 22 and pnpm (enable with `corepack enable pnpm`).

```bash
pnpm install
pnpm dev             # server (tsx watch, :8080) + Vite (:5173, proxies /api and /socket.io)
pnpm build           # web → apps/web/dist, server → apps/server/dist (esbuild bundle)
pnpm start           # production server; also serves apps/web/dist
pnpm test            # all Vitest tests
pnpm typecheck
pnpm simulate --players 8               # bots play a full game (kill, QR report, vote) against a running server
pnpm simulate --players 4 --passive     # bots join/arrive/vote "skip"; drive the game from /admin
```

Single test file / test: `pnpm vitest run apps/server/test/engine.test.ts -t "restarts the team cooldown"`.

Env vars: `PORT` (8080), `PUBLIC_URL` (URL encoded in every QR code; required in production, auto-detected LAN IP in dev — with `pnpm dev` set it to the Vite port, e.g. `http://192.168.1.10:5173`), `ADMIN_PIN` (required in production, `1234` in dev), `HMAC_SECRET` (generated into `DATA_DIR/hmac_secret` if absent), `DATA_DIR` (`./data` in dev), `TIME_SCALE` (dev-only duration multiplier, e.g. `0.2`). Add `?dev=1` to the player URL to keep sessions per tab (several players in one browser).

Docker is deliberately not used during MVP development; SPEC §4 Dockerfile/compose must be added back before deploying to the Pi (native `better-sqlite3` build for ARM).

## Architecture

pnpm monorepo: `packages/shared` (types, params + validation, event names/payloads, colors — imported as TS source, no build step), `apps/server` (Fastify + Socket.IO + better-sqlite3), `apps/web` (Vite + React, no router/CSS framework).

### Server data flow

Every state change goes through `GameRuntime.dispatch(command)` (`apps/server/src/game.ts`):

1. `reduce(state, command, now, rng)` in `src/engine/` — **pure and deterministic**, never mutates its input (it `structuredClone`s). Rejected or stale commands return the *same state object* plus an optional typed `error`; callers detect "no change" by identity.
2. Accepted commands are journaled and the full state snapshotted in SQLite in one transaction (`persistence.ts`).
3. Timers are **derived from state** (`engine/timers.ts: timersFromState`), not tracked separately: `Scheduler.sync` holds exactly that set (keyed by id, rescheduled when the deadline or command changes). Tick commands carry a key/deadline and are ignored when stale. This is why restart recovery is just "load snapshot + sync timers".
4. `Transport.onResult` (`transport/socket.ts`) recomputes group rooms, routes engine events, then sends each socket a per-client filtered `state:sync` view **only if its JSON changed** — so a crewmate receives nothing when someone secretly dies.

Things outside the engine because they need secrets or wall-clock: HMAC tokens (`tokens.ts`), rotating body QR pushes (1 s interval in `Transport`), admin PIN rate limiting (`auth.ts`). QR scans arrive via REST (`transport/rest.ts`), which verifies the token and then dispatches `player:reportBody` / `player:emergency`.

### Information-hiding rules (anti-cheat)

- `engine/views.ts` decides what each client may know; `publicPlayers.dead` is true only for `GHOST` (unreported bodies stay hidden until a meeting). Roles reach only their owner, fellow impostors, the admin, the ejected player's role if `confirmEjects`, and everyone at `GAME_OVER`. Tests in `engine.test.ts` ("never leaks roles…") guard this.
- Shared actions must behave identically for crew and impostors (an impostor may declare their own death; refusing would reveal the role). The player screen is identical for both roles; the only difference is the tiny status dot when an impostor's kill is ready.
- No sound on the victim's phone at kill time or on impostors' phones at `kill:ready`.

### State machines (SPEC §5)

`LOBBY → ROLE_REVEAL → PLAYING ⇄ MEETING(GATHERING → DISCUSSION → VOTING → RESULT) → GAME_OVER → LOBBY`. Player status `ALIVE → DYING → BODY → GHOST` (or `ALIVE → GHOST` on ejection). `DYING` counts as alive for win conditions. Starting a meeting finalizes all `DYING` and turns every `BODY` into `GHOST`. Win conditions are an ordered list in `reduce.ts` (`WIN_CONDITIONS`) so a tasks condition can plug in later.

### Web client

`lib/socket.ts: useGameConnection` opens one socket per view; rendering depends only on the latest `state:sync`, other events only trigger effects (alarm, vibration, QR). Deadlines are server timestamps: use `useNow()`/`serverNow()` from `lib/clock.ts` (clock offset synced over `clock:sync`). Mobile constraints (plain HTTP): wake lock via NoSleep.js video fallback, Web Audio synthesized sounds unlocked by a gesture, vibration always doubled by a visual cue, no `crypto.randomUUID` client-side; after a reload, the next tap re-arms sound and wake lock (`lib/wakeLock.ts`).

## Tests

`apps/server/test/`: `engine.test.ts` drives the reducer with `Harness` (fake clock that fires derived timers in order); `integration.test.ts` boots the real app on a random port with a temp SQLite file and uses `TestClient` (also reused by `scripts/simulate.ts`).

## Out of scope for MVP

Tasks (extension points only: `Station` type, `/s/` prefix, `tasks` slot in `PlayerView`, `WIN_CONDITIONS`, `freezeTasksDuringMeeting`), sabotage/minigames, ESP32/MQTT hardware, killer self-ID by victim, game pause, cross-game stats.
