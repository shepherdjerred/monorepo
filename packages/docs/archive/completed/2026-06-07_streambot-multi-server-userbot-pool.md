---
id: reference-completed-2026-06-07-streambot-multi-server-userbot-pool
type: reference
status: complete
board: false
---

# Streambot multi-server via a pool of userbots

## Context

`packages/streambot` was a single-process, single-guild, single-userbot Discord video bot: one
command bot, one selfbot streamer, one XState actor, single-valued config (`GUILD_ID`,
`VIDEO_CHANNEL_ID`, `TOKEN`). Goal: serve **many servers** — and **many voice channels per server** —
from one process using a **pool of userbots** (N user tokens). A play acquires a free userbot that is
a member of the requesting guild and runs an isolated session for that voice channel; if none is free
the bot replies "No stream bots are available right now."

Decisions (confirmed with user): dynamic voice channel = the issuer's current VC (no per-guild channel
config); per-`(guild, channel)` resume; one in-process pool (one pod); global slash-command
registration; membership discovered at runtime from `client.guilds.cache`.

## What changed

| Area              | Change                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config            | `discord.userToken` → `discord.userTokens: z.array().min(1)` (`USER_TOKENS`, comma-sep; `TOKEN` fallback). Dropped `guildId`/`statusChannelId`/`videoChannelId`.                                                                                                                                  |
| Streamer          | Constructor takes its own `userToken` + `Pick<Config,"stream">`; `login()` awaits `ready` (so `guilds.cache` is hydrated); added `guildIds()` and a `StreamerLike` interface.                                                                                                                     |
| Pool (new)        | `src/pool/userbot-pool.ts` — eager login of all tokens, membership snapshot, `acquire(guildId)`/`release`, fail-soft per token (throws only if all fail). Injectable `StreamerFactory` for tests.                                                                                                 |
| Session mgr (new) | `src/session/session-manager.ts` — `Map<"guild:channel", Session>`; `ensureForPlay`/`getExisting`/`activeSessionByChannel`/`resumeAll`/`destroyAll`. Per-session actor + StatusReporter + checkpoint loop; teardown releases the userbot (guarded by `hasStarted` to avoid the boot-`idle` race). |
| View (new)        | `src/machine/view.ts` — shared `buildPlaybackView` projection (index/e2e/session).                                                                                                                                                                                                                |
| Command bot       | Global registration; routes by `interaction.guildId` + issuer's VC; "no bots available" / "join a VC" / "nothing playing in your channel" replies; per-`(guild,channel)` alone-timers; `announce(channelId, msg)`.                                                                                |
| Resume            | Per-`(guild,channel)` files `playback-state-<g>-<c>.json`, schema **v2** (+`statusChannelId`); `listPersistedStateFiles`/`deleteState`; v1 files fail-soft.                                                                                                                                       |
| index.ts          | New wiring: pool → command bot → session manager (late-bound via holder), `resumeAll()` after login.                                                                                                                                                                                              |
| Deploy            | `packages/homelab/.../streambot.ts`: `TOKEN`→`USER_TOKENS`, dropped `GUILD_ID`/`VIDEO_CHANNEL_ID`/`COMMAND_CHANNEL_ID`. Stays one pod.                                                                                                                                                            |
| Dagger            | `e2eStreambot` dropped `commandChannelId`; uses `USER_TOKENS` secret + `E2E_GUILD_ID`/`E2E_VIDEO_CHANNEL_ID` env. Smoke test uses `USER_TOKENS`.                                                                                                                                                  |
| Tests             | New `userbot-pool.test.ts`, `session-manager.test.ts`; updated config/streamer/persistence/resume tests for the new shapes.                                                                                                                                                                       |

## Verification

- `packages/streambot`: `bun run typecheck` ✅, `bunx eslint .` ✅, `bun run test` ✅ (167 pass).
- `packages/homelab`: `bun run typecheck` ✅; streambot deployment test ✅.
- **k8s synth** (`bun run src/app.ts`): the `media` chart wires `USER_TOKENS`/`BOT_TOKEN`/`ADMIN_IDS`
  from the `media-streambot-config` secret (OnePasswordItem → vault `streambot-config`), with no
  leftover `TOKEN`/`GUILD_ID`/`VIDEO_CHANNEL_ID`/`COMMAND_CHANNEL_ID`. ✅
- **Live Dagger e2e** (`dagger call e-2-e-streambot`, real test-guild creds): `resume PASS`,
  `DAGGER_EXIT=0`. Confirmed end-to-end — command bot + selfbot login, **membership discovery
  (`guilds: 2`)**, voice join, subtitled stream, persist, and resume-at-offset (5.03s vs 5.19s) across
  a simulated restart. Fixed a pre-existing e2e harness race (read `getPosition()` before the streamer
  anchored its clock) by polling for the anchor.
- `.dagger`: not standalone-typecheckable locally (`@dagger.io/dagger` SDK is `dagger develop`-generated);
  edits are mechanical and consistent across helper + `@func`. The e2e run above exercised them for real.
- Note: the "offline 1Password field linter" prior sessions referenced has been **removed** from the
  repo, so nothing gates a `fromSecret` reference at commit time — a missing field only surfaces at
  deploy as a pod CrashLoop (see below).

## Remaining / operator steps

1. ~~Add a `USER_TOKENS` field to the `streambot-config` 1Password item.~~ **DONE 2026-06-07** —
   added a concealed `USER_TOKENS` field seeded from the existing `TOKEN` value (verified identical),
   kept `TOKEN` as the code fallback, appended a migration note to both `streambot-config` and
   `streambot-tmdb`. The 1Password operator synced `USER_TOKENS` into the live `media-streambot-config`
   Secret (confirmed via `kubectl`). To grow the pool later, append more comma-separated tokens (one
   per additional Discord account, each invited to the target servers). `TOKEN` can be removed once the
   pool is confirmed in prod. **Remaining:** merge this branch so ArgoCD rolls out the new
   manifest+image (the running pod still uses the old `TOKEN` manifest until then — no disruption).
2. Run the live Dagger e2e (`e-2-e-streambot`, pool-of-1) to confirm login/register/join/stream/resume
   under the new env names.
3. Each userbot account must be invited to the target servers (membership = what it can serve); the
   command bot must be invited to a superset of those servers.

## Session Log — 2026-06-07

### Done

- Implemented the full userbot-pool + per-`(guild,channel)` session architecture across
  `packages/streambot` (config, streamer, new `pool/` + `session/` + `machine/view.ts`, command bot,
  index wiring, resume v2), the homelab deployment, the Dagger e2e/smoke helpers, and docs.
- Added `userbot-pool.test.ts` + `session-manager.test.ts`; updated existing tests. Streambot
  typecheck/lint/test all green; homelab typecheck green.
- Updated `packages/streambot/AGENTS.md` and memory `project_streambot_e2e_test_server`.

### Remaining

- Operator: add `USER_TOKENS` to the `streambot-config` 1P item; run live e2e; invite userbots/bot to
  target guilds. (See "Remaining / operator steps".)

### Caveats

- Global slash-command registration takes up to ~1h to propagate the first time.
- Pool size bounds concurrent streams (one userbot = one VC at a time); N concurrent ffmpeg/VAAPI
  encodes share one host/`vaapiDevice` — an operational ceiling, not a correctness bug.
- `adminIds` is global (an admin can stop/clear in any guild they invoke in) — matches "no clever
  scoping"; per-guild admins are a follow-up.
- Local-only friction: `scripts/setup.ts` builds `discord-video-stream` d.ts into
  `packages/discord-video-stream/dist` but not into the workspace `node_modules/@shepherdjerred/discord-video-stream/dist`
  copies, so `streambot` `tsc` resolves the dvs **source** (loose typing → spurious errors) until you
  copy `dist` into both `node_modules` copies (root + `packages/streambot`). See Workflow Friction.

## Workflow Friction

- **`setup.ts` leaves stale `discord-video-stream` in workspace `node_modules`.** After setup,
  `packages/streambot` `tsc` failed with ~40 errors from `../discord-video-stream/src/*` because the
  package's `exports` "types" → `dist/index.d.ts` didn't exist in the **copied** node_modules entries
  (`node_modules/@shepherdjerred/discord-video-stream/` and
  `packages/streambot/node_modules/@shepherdjerred/discord-video-stream/`), so tsc fell back to the
  `default` → `src/*.ts` and type-checked the fork's source. Fix was to copy
  `packages/discord-video-stream/dist/` into both node_modules copies. Setup should sync the built dvs
  `dist` into the workspace node_modules copies (or the file: dep should be symlinked) so a fresh
  worktree typechecks streambot without manual copying.
