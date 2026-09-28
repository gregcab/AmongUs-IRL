# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Among Us IRL": a local web app (mini-PC or Raspberry Pi 5) that referees a real-life, phone-based game of Among Us. Local Wi-Fi only, plain HTTP (no TLS). [SPEC.md](SPEC.md) (in French) is the source of truth for rules, event contracts and data model — read the relevant section before changing game behavior.

Three views, one React app: player (`/`, phone portrait), TV (`/tv`, no interaction), game-master console (`/admin`, PIN-protected; the GM sees all roles and does not play). QR scan landing pages: `/r/:token` (body report), `/e/:token` (emergency station), `/t/:token` (lobby scan practice shown on the TV); `/s/:token` (printed station) opens the player app itself on the station screen, where players repair sabotages and do their tasks (SPEC §17–19).

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
pnpm simulate --players 8               # bots play a full game (kill, QR report, sabotage, vote) against a running server
pnpm simulate --players 4 --passive     # bots join/arrive/vote "skip"; drive the game from /admin
pnpm build && pnpm screenshots          # regenerate docs/screenshots (needs Google Chrome)
```

In both simulate modes, living bots repair every sabotage and bots do a task step every `--task-every` seconds (default 20, `0` = never); they read the station codes from the admin's printable page. `.claude/launch.json` has `dev-server` (:8095) and `dev-web` (:5180) configs for a preview that does not clash with a running `pnpm dev`.

Single test file / test: `pnpm vitest run apps/server/test/engine.test.ts -t "restarts the team cooldown"`.

Env vars: `PORT` (8080), `PUBLIC_URL` (URL encoded in every QR code; required in production, auto-detected LAN IP in dev — with `pnpm dev` set it to the Vite port, e.g. `http://192.168.1.10:5173`), `ADMIN_PIN` (required in production, `1234` in dev), `HMAC_SECRET` (generated into `DATA_DIR/hmac_secret` if absent), `DATA_DIR` (`./data` in dev), `TIME_SCALE` (dev-only duration multiplier, e.g. `0.2`). Add `?dev=1` to the player URL to keep sessions per tab (several players in one browser).

Deployment is Docker (`Dockerfile`, `docker-compose.yml`); CI (`.github/workflows/ci.yml`) typechecks, tests, builds and builds the image for amd64 and arm64 (native `better-sqlite3` on the Pi).

## Architecture

pnpm monorepo: `packages/shared` (types, params + validation, event names/payloads, colors, the station catalog `stations.ts` and the task catalog `tasks.ts` — imported as TS source, no build step), `apps/server` (Fastify + Socket.IO + better-sqlite3), `apps/web` (Vite + React, no router/CSS framework).

### Server data flow

Every state change goes through `GameRuntime.dispatch(command)` (`apps/server/src/game.ts`):

1. `reduce(state, command, now, rng)` in `src/engine/` — **pure and deterministic**, never mutates its input (it `structuredClone`s). Rejected or stale commands return the *same state object* plus an optional typed `error`; callers detect "no change" by identity. `reduce.ts` orchestrates phases, meetings and wins; `sabotage.ts` and `tasks.ts` mutate the working copy through the shared `Ctx` (`ctx.ts`) and return an `Outcome`, `reduce.ts` then runs `checkWin`.
2. Accepted commands are journaled and the full state snapshotted in SQLite in one transaction (`persistence.ts`).
3. Timers are **derived from state** (`engine/timers.ts: timersFromState`), not tracked separately: `Scheduler.sync` holds exactly that set (keyed by id, rescheduled when the deadline or command changes). Tick commands carry a key/deadline and are ignored when stale. This is why restart recovery is just "load snapshot + sync timers" (`upgradeState` fills parameters added since the snapshot was written). Fingers held on a station (`state.holds`: reactor, shield) expire 4 s after the last heartbeat through such derived timers; the sabotage deadline and the shield charge are derived too.
4. `Transport.onResult` (`transport/socket.ts`) recomputes group rooms, routes engine events, then sends each socket a per-client filtered `state:sync` view **only if its JSON changed** — so a crewmate receives nothing when someone secretly dies.

Things outside the engine because they need secrets or wall-clock: HMAC tokens (`tokens.ts`), rotating body QR pushes (1 s interval in `Transport`), admin PIN rate limiting (`auth.ts`). QR scans arrive via REST (`transport/rest.ts`), which verifies the token and then dispatches `player:reportBody` / `player:emergency` / `player:practiceScan`. A body can also be reported by typing its rotating 4-digit code (`player:reportCode` socket event, handled in `Transport.onReportCode` with a per-player lockout against brute force) — needed because the phone camera may open a browser without the session. Station commands (`station:*`, `task:*`) carry `at: { token } | { code }`; `Transport.onStation` turns it into a `stationId` (HMAC station token bound to the game, or the 4-digit code printed under it, `Tokens.stationCodes`) before dispatching; wrong station and O2 codes share an `AttemptLimiter`. `GameRuntime.stop()` makes later dispatches no-ops so closing sockets cannot re-arm timers.

### Information-hiding rules (anti-cheat)

- `engine/views.ts` decides what each client may know; `publicPlayers.dead` is true only for `GHOST` (unreported bodies stay hidden until a meeting). Roles reach only their owner, fellow impostors, the admin, the ejected player's role if `confirmEjects`, and everyone at `GAME_OVER`. Tests in `engine.test.ts` ("never leaks roles…") guard this.
- Shared actions must behave identically for crew and impostors (an impostor may declare their own death; refusing would reveal the role). The player screen is identical for both roles; the only difference is the tiny status dot when an impostor's kill is ready.
- The sabotage menu hides in the "hold to see your role" pad (`HoldToReveal` with `overlay` + `onAction`): holding shows the role card full screen; only an impostor's card has the `data-reveal-action="sabotage"` target, and releasing there after sliding opens the menu. `sabotageCooldownEndsAt` goes to impostors only; the saboteur (`sabotage.by`) to the admin only; O2 codes only to players who opened the admin station (`codeReaders`).
- Impostors get a fake task list drawn like the real ones (same ids, same shape, same mini-games and answers); `crewProgress` only counts crew tasks. Never add a field that differs between real and fake tasks.
- No sound on the victim's phone at kill time or on impostors' phones at `kill:ready`.

### State machines (SPEC §5)

`LOBBY → ROLE_REVEAL → PLAYING ⇄ MEETING(GATHERING → DISCUSSION → VOTING → RESULT) → GAME_OVER → LOBBY`. `admin:backToLobby` also aborts a running game from any phase. Player status `ALIVE → DYING → BODY → GHOST` (or `ALIVE → GHOST` on ejection). `DYING` counts as alive for win conditions. Starting a meeting finalizes all `DYING`, turns every `BODY` into `GHOST`, cancels the running sabotage and resets the cooperative stations. Win conditions are an ordered list in `reduce.ts` (`WIN_CONDITIONS`: no impostor left, all crew tasks done, parity); an unrepaired critical sabotage ends the game from its deadline tick. `GameState.winReason` tells why.

### Web client

`lib/socket.ts: useGameConnection` opens one socket per view; rendering depends only on the latest `state:sync`, other events only trigger effects (alarm, vibration, QR, sabotage alert). Deadlines are server timestamps: use `useNow()`/`serverNow()` from `lib/clock.ts` (clock offset synced over `clock:sync`). Mobile constraints (plain HTTP): wake lock via NoSleep.js video fallback, Web Audio synthesized sounds unlocked by a gesture, vibration always doubled by a visual cue, no `crypto.randomUUID` client-side, no camera access (native camera only); after a reload, the next tap re-arms sound and wake lock (`lib/wakeLock.ts`).

`PlayerApp` takes the `/s/:token` station token, opens it once the session is known (`station:open`) and renders `player/station.tsx` (sabotage repairs) or `player/tasks.tsx` (task stations, cooperative tasks) over the game; mini-games live in `player/minigames.tsx` and only report success (`task:complete`). `HoldPad` sends `station:hold` heartbeats while pressed. An effect must never return a value other than a cleanup function: `window.scrollTo` returns a promise in recent Chrome, which crashed the station screen once.

## Tests

`apps/server/test/`: `engine.test.ts` drives the reducer with `Harness` (fake clock that fires derived timers in order; sabotage and task suites included); `integration.test.ts` boots the real app on a random port with a temp SQLite file and uses `TestClient` (also reused by `scripts/simulate.ts` and `scripts/screenshots.ts`).

## Out of scope

Comms sabotage, visual and physical tasks from `docs/propositions-taches.html`, ESP32/MQTT hardware, killer self-ID by victim, game pause, cross-game stats.
