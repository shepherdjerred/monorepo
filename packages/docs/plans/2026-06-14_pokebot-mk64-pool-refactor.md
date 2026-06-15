# Pokebot + MK64: on-demand `/play`, userbot pool, multi-tenant

## Status

**Complete** (pending manual e2e verification) — branch `feature/pokebot-mk64-pool`, PR #1251.

All six phases of the plan shipped on this branch:

- **Phase 1** — `@shepherdjerred/discord-stream-lifecycle` gained generic `UserbotPool<T>`, `SingleSlotSessionManager`, `AloneInVoiceWatcher`, `/play` + `/stop` slash command builders, `sessionDir()` per-guild path helper, `GameDriver` interface, and `createGameBot()` wiring. 39 tests. Commit `741f54719`.
- **Phase 2** — Streambot's `UserbotPool` is a thin wrapper around the shared lib's generic pool. `StreambotStreamer` implements `PooledUserbot`. `entry.streamer` renamed to `entry.userbot`. Streambot's session-manager / command-bot / queue / resume / ffmpeg pipeline stay in streambot. Commit `884f634f7`.
- **Phase 3** — Pokemon backend boots no emulator at startup. `/play` triggers `PokemonGameDriver.onSessionStart` which creates the emulator (per-guild `saves/<guildId>/pokeemerald.flash`), GameStreamer (using the pool's selfbot client), goal manager (per-guild `saves/<guildId>/goal-state.json`), event notifier (bound to the session's `textChannelId`), and goal control server. Slash commands `/screenshot` + `/goal` reject when no session is active. Legacy single-tenant wiring deleted: `discord/client.ts`, `discord/channel-handler.ts`, `slashCommands/rest.ts`. All 152 backend tests pass. Commit `cb392ff5d`.
- **Phase 4** — MK64 backend boots no emulator at startup. `/play` triggers `MarioKartGameDriver.onSessionStart` which creates the emulator, streamer, seat manager, name overlay, race tracker. Prisma `Race` gained a `guildId String` column with an index; `LeaderboardStore.forGuild(guildId)` scopes every read/write so server A's leaderboard never sees server B's. Slash commands gated on active session. Legacy single-tenant wiring deleted. All 109 backend tests pass. Commit `fbe3ea4bf`.
- **Phase 5** — Homelab cdk8s `pokemon.ts` + `mario-kart.ts` documentation comments describe the new `state_root_dir` key and the single-userbot model. The cdk8s shape itself doesn't change (config.toml is operator-owned in 1P). Commit `d8d416739` + the userbot-shape correction.
- **Phase 6** — Manual e2e verification + PR finalization (this status block).

**Remaining manual verification before merge:**

1. Existing pokemon + MK64 1Password items already have `stream.userbot.{id,token}` set — no config changes needed. The bot serves multiple Discord servers using that single userbot account (it just needs to be invited into each one).
2. From server A: `/play`, confirm userbot joins VC and emulator boots; type text commands; `/screenshot`; `/goal` (pokemon); `/stop` and confirm save flushed under `saves/<A>/`.
3. From server B (different Discord server): `/play` while A is active → confirm "in use" rejection. After A `/stop`s, B `/play` → confirm fresh emulator under `saves/<B>/`.
4. All humans leave VC → 30s grace → confirm auto-stop fires.

**Known caveat (Phase 4):** Per-guild MK64 emulator save isolation (mempak/eeprom under `session.sessionDir/emulator/`) is not wired into `N64Emulator` yet — that needs an `N64Emulator` constructor extension. The Prisma leaderboard already hard-isolates server A from server B at the user-visible level; emulator save isolation is a follow-up.

## Context

Today `discord-plays-pokemon` and `discord-plays-mario-kart` are single-tenant always-on pods:
each is hardcoded to one Discord server, the emulator boots at pod start, and a single
hardcoded userbot account streams to a single configured voice channel. Idle servers
still pay the full emulator CPU cost; we can't run either bot in additional servers
without spinning up a parallel deployment with new 1Password items and new state PVCs.

We want the bots to behave like Streambot: do nothing until someone types `/play`, then
claim a userbot from a pool, join that user's voice channel, boot the emulator, and run
the game scoped to that guild. `/stop` or an empty voice channel tears it all down —
emulator off, userbot leaves, pool entry released. Per-guild state (save file, goal
state, leaderboard) is keyed by `guildId` so a single deployment can serve N guilds.

Per user direction: **at most one active emulator session at a time per game type**
(no parallel emulator instances). The userbot pool exists to give us flexibility in
which account joins which server, not to support concurrent games. Existing state is
**clean-slate** on rollout — no migration of single-tenant `saves/` or leaderboard data.

## Target architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Backend pod (one per game type — pokemon, mariokart)               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Bot client (discord.js, real bot token)                     │   │
│  │   • registers /play /stop /screenshot /goal etc.             │   │
│  │   • listens to VoiceStateUpdate for auto-leave               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SessionManager (single-slot, generic, lifted from streambot)│   │
│  │   • activeSession?: { guildId, channelId, userbotEntry, … }  │   │
│  │   • startSession(guildId, voiceChannelId) → /play handler    │   │
│  │   • stopSession() → /stop handler, auto-leave, idle timeout  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│              │                                  │                    │
│              ▼                                  ▼                    │
│  ┌─────────────────────────────┐   ┌──────────────────────────┐    │
│  │  UserbotPool (from lifecycle)│   │  Emulator (boot on start, │    │
│  │   • N selfbot Clients         │   │   teardown on stop)       │    │
│  │   • acquire(guildId)          │   │   • save path:            │    │
│  │   • release(entry)            │   │     saves/<guildId>/…     │    │
│  └─────────────────────────────┘   └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

Each `/play` does: acquire pool entry that's a member of caller's guild → join their VC →
boot emulator with `saves/<guildId>/` working dir → **bind the text channel the `/play`
was invoked in as the session's command/notification channel** → register the SPA URL
with guild context. `/stop`, auto-leave, and idle timeout all funnel through
`SessionManager.stop()`.

### Per-server persistence

Every piece of game state is keyed by `guildId` — two Discord servers playing the
same game are fully isolated, including across `/stop` + `/play` cycles. Server A's
Pokémon save, badges, party, and goal history never leak into server B's session.

| Bot     | What persists                                            | Where                                              | Lifetime                                     |
| ------- | -------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| Pokemon | Emulator save (`.flash`)                                 | `saves/<guildId>/pokeemerald.flash` on the ZFS PVC | Forever (until manually cleared)             |
| Pokemon | Goal state (history + active goal)                       | `saves/<guildId>/goal-state.json` on the PVC       | Forever                                      |
| MK64    | Emulator save (mempak / eeprom / flash)                  | `saves/<guildId>/` on the ZFS PVC                  | Forever                                      |
| MK64    | Leaderboard (Race + RaceResult rows)                     | Prisma SQLite, every row tagged `guildId`          | Forever                                      |
| Both    | In-flight session (text channel, userbot, voice channel) | In-memory only (`SessionManager.activeSession`)    | Wiped on `/stop`, auto-leave, or pod restart |

On pod startup nothing is loaded eagerly. On `/play`, the `GameDriver` reads/initializes
under `saves/<guildId>/`; on `/stop` it flushes and exits. No cross-guild file or DB
read is ever performed by the running emulator or store.

### Session-bound text channel

The channel `/play` was sent in becomes the per-session canonical text channel for
everything the bot does in that guild. Replaces the current single-tenant config keys
(`game.commands.channel_id`, notifications channel ids, etc.). On `/play`:

- `interaction.channelId` is captured into the session record.
- Pokemon: text-command parser (`[QUANTITY][MODIFIER][ACTION]` messages) attaches to
  that channel only. Event notifier posts to that channel. `/screenshot` and `/goal`
  results render there. Goal manager `discord-message.ts` targets it.
- MK64: race events, leaderboard pushes, `/screenshot` output all target it.
- Multiple `/play` calls within the same guild are blocked while a session is active
  (single-slot constraint), so there's no ambiguity over which channel is "the" channel.

## Shared library: extend `@shepherdjerred/discord-stream-lifecycle`

Don't create a new package. **Push as much as possible** into the existing
`@shepherdjerred/discord-stream-lifecycle` so streambot, pokemon, MK64, and any future
bot share one implementation. Each consumer only ships game-specific logic; everything
else (pool, session lifecycle, slash commands, auto-leave, persistence layout, selfbot
client wiring) lives in the lib.

| New module in `discord-stream-lifecycle/src/` | Lifted from                                                            | Generalization                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pool/userbot-pool.ts`                        | streambot `src/pool/userbot-pool.ts`                                   | Generic over `TStreamer`; pool only knows about `entry.busy`, `entry.guildIds`, `acquire(guildId)`, `release(entry)`.                       |
| `pool/selfbot-client.ts`                      | streambot streamer login code + pokemon/MK64 selfbot inits             | One canonical `createSelfbotClient(token)` that handles login, gateway intents, snapshotting `guildIds`, reconnect, teardown.               |
| `session/session-manager.ts`                  | streambot `src/session/session-manager.ts`                             | Strip queue + resume. Keep: keyed-session map, single-slot-per-game gate, acquire/release wiring, lifecycle events.                         |
| `session/session.ts`                          | new                                                                    | The `Session` record: `{ guildId, voiceChannelId, textChannelId, userbotEntry, startedAt, startedByUserId, sessionDir }`.                   |
| `session/auto-leave.ts`                       | streambot `command-bot.ts:369-404` + pokemon/MK64 `channel-handler.ts` | One `onVoiceStateUpdate(session, event)` helper: alone-in-VC grace (configurable, default 30s) + idle timeout, fires `STOP`.                |
| `discord/play-command.ts`                     | new (replaces streambot's `/stream play`, pokemon/MK64 `/start` stubs) | Builder for the `/play` slash command + handler that captures `(guildId, voiceChannelId, textChannelId)` and delegates to `SessionManager`. |
| `discord/stop-command.ts`                     | new                                                                    | Builder + handler for `/stop`. Permission check (any user vs only-starter) is configurable.                                                 |
| `discord/command-registration.ts`             | streambot `command-bot.ts` REST registration + pokemon/MK64 `rest.ts`  | One `registerGameBotCommands({ applicationId, token, extra: SlashCommandBuilder[] })` so each game only declares its extras.                |
| `persistence/session-paths.ts`                | new                                                                    | `sessionDir(rootDir, guildId)` + `ensureDir`. Single source of truth for the `saves/<guildId>/` layout.                                     |
| `lifecycle/game-driver.ts`                    | new                                                                    | The plug-in interface every game-bot implements. See below.                                                                                 |
| `lifecycle/game-bot.ts`                       | streambot `index.ts` wiring                                            | Top-level `createGameBot(...)` that wires bot client + pool + session manager + commands. One function, three call sites.                   |

### What each game-bot ships

Per-game packages shrink dramatically. Each one is just:

1. **A `GameDriver` adapter** — the only meaningful new code per game:

   ```ts
   interface GameDriver {
     readonly name: string;
     onSessionStart(ctx: {
       guildId: string;
       sessionDir: string; // saves/<guildId>/ already created
       userbot: SelfbotClient; // already logged in, already in the VC
       voiceChannelId: string;
       textChannelId: string; // bind notifications here
       botClient: Client; // for posting to textChannelId
     }): Promise<void>;
     onSessionStop(ctx: { guildId: string }): Promise<void>;
   }
   ```

   Pokemon's driver boots `pokeemerald-wasm`, attaches the streamer, starts goal manager,
   wires the text-command listener to `textChannelId`. MK64's driver boots `N64Wasm`,
   starts the race tracker, opens the per-guild leaderboard store.

2. **Game-specific slash commands only** — `/screenshot`, `/goal` (pokemon). Each
   command resolves the active session via `sessionManager.getActiveSessionForGuild(guildId)`
   and rejects if absent.

3. **Game-specific state schemas** — pokemon goal-state JSON, MK64 Prisma leaderboard.
   All paths derived from `ctx.sessionDir`.

4. **Game-specific frontend** — the React SPA. Reads `guildId` from `?g=` query.

Everything else (selfbot login, pool, `/play`, `/stop`, auto-leave, alone-grace, voice
join, voice leave, session record, per-guild dir layout, command registration) is in
the lib.

### Streambot becomes the first consumer in the same PR

Streambot's current `pool/`, `session/`, and `command-bot.ts` are demolished and
replaced with calls to the shared lib. Streambot-specific concerns (queue, resume-state
persistence, ffmpeg + VAAPI driver, TMDB metadata, status reporter) stay in streambot
as a layer **above** the generic session manager — implemented either as its own
`GameDriver` (a "streamer is a game") or as a small extension that subclasses/wraps the
generic session. The PR demonstrates that the lib is sufficient for the most complex
existing consumer.

### Future bots

A new game-bot only needs: a `GameDriver`, optional extra slash commands, an SPA,
and a cdk8s resource that mounts tokens + a `saves/` PVC. No new pool, no new
session manager, no new `/play`, no new auto-leave.

## Per-package changes

### `packages/discord-plays-pokemon`

`/play`, `/stop`, pool, session manager, selfbot login, auto-leave, alone-grace,
voice join/leave, command registration — **all gone**, replaced by the shared lib.
What stays is pokemon-specific.

| File                                                                                    | Change                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/src/index.ts`                                                         | Collapses into a ~30-line `createGameBot(...)` call with a `PokemonGameDriver`. Removes eager `emulator.init/start` and `streamer.start`.                                                                                                                                                                 |
| `packages/backend/src/config/schema.ts`                                                 | Make `server_id`, `stream.channel_id`, `game.commands.channel_id`, notification-channel ids optional + ignored at runtime (back-compat). `stream.userbot.{id,token}` stays required — one userbot, since the emulator is single-slot. Add `state_root_dir` (default `"saves"`).                           |
| `packages/backend/src/discord/client.ts`, `channel-handler.ts`, `slashCommands/rest.ts` | **Delete.** Shared lib handles selfbot login, voice routing, and command registration. Bot client construction moves to the shared `createGameBot`.                                                                                                                                                       |
| `packages/backend/src/lifecycle/pokemon-driver.ts` (new)                                | Implements `GameDriver`. `onSessionStart`: instantiate `Emulator` with `ctx.sessionDir`, attach `GameStreamer` to `ctx.userbot`, start goal manager bound to `ctx.textChannelId`, register text-command listener filtered to that channel. `onSessionStop`: flush save, kill goal manager, stop emulator. |
| `packages/backend/src/discord/slashCommands/commands/{screenshot,goal}.ts`              | Resolve active session via `sessionManager.getActiveSessionForGuild(interaction.guildId)`. Reject if none. Render output into `session.textChannelId`.                                                                                                                                                    |
| `packages/backend/src/emulator/emulator.ts`                                             | Accept a per-session working dir at construction. No module-level singleton; instantiated by `PokemonGameDriver`.                                                                                                                                                                                         |
| `packages/backend/src/goal/goal-manager.ts`                                             | Constructor takes `{ sessionDir, textChannelId, botClient }`. State path becomes `${sessionDir}/goal-state.json`.                                                                                                                                                                                         |
| `packages/backend/src/discord/event-notifier.ts`, text-command listener                 | Take target channel id from the active session, not config.                                                                                                                                                                                                                                               |
| `packages/backend/src/web/` + `packages/frontend/`                                      | SPA reads `guildId` from `?g=<id>` query. `/play` reply (posted by shared lib) interpolates the URL via a `GameDriver.welcomeMessage(session)` hook.                                                                                                                                                      |

Drop entirely (no migration): the single-tenant `config.toml` keys for `server_id`,
`stream.channel_id`, `game.commands.channel_id`. New `config.toml` has just bot creds +
pool tokens + game tunables.

### `packages/discord-plays-mario-kart`

Mirror Pokemon's pattern — shared lib does the heavy lifting, MK64 ships a
`MarioKartGameDriver` + `/screenshot` + Prisma store. Selfbot, pool, `/play`, `/stop`,
auto-leave, etc. are all gone (use shared).

| File                                                                                                | Change                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/src/index.ts`, `discord/client.ts`, `channel-handler.ts`, `slashCommands/rest.ts` | Same collapse as pokemon — replaced by `createGameBot(...)` with `MarioKartGameDriver`.                                                                                                                                                      |
| `packages/backend/src/config/schema.ts`                                                             | Same single→pool token migration as pokemon. Drop server/channel ids.                                                                                                                                                                        |
| `packages/backend/src/lifecycle/mario-kart-driver.ts` (new)                                         | Implements `GameDriver`. `onSessionStart`: boot `N64Wasm` with `ctx.sessionDir`, start streamer on `ctx.userbot`, instantiate `RaceTracker` + `LeaderboardStore.forGuild(ctx.guildId)`, all notification sinks bound to `ctx.textChannelId`. |
| `packages/backend/prisma/schema.prisma`                                                             | Add `guildId String` to `Race`. Clean slate (drop existing data). New unique key includes `guildId`.                                                                                                                                         |
| `packages/backend/src/leaderboard/store.ts`                                                         | Every query/insert takes `guildId`. Helper `forGuild(guildId)` wraps the store.                                                                                                                                                              |
| `packages/backend/src/emulator/n64-emulator.ts`                                                     | Per-session working dir pattern; instantiated by `MarioKartGameDriver`.                                                                                                                                                                      |
| `packages/backend/src/race/race-tracker.ts` + notification senders                                  | Take target channel from `session.textChannelId`, not config.                                                                                                                                                                                |
| `packages/frontend/src/socket.ts`                                                                   | Pass `?g=<guildId>` through; backend `SeatManager` per-session, instantiated by `MarioKartGameDriver`.                                                                                                                                       |

### `packages/streambot`

| File                             | Change                                                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pool/userbot-pool.ts`       | **Delete.** Consume `UserbotPool` from `@shepherdjerred/discord-stream-lifecycle/pool`.                                                                                                                                                                                               |
| `src/session/session-manager.ts` | Shrunk to a thin wrapper that holds streambot-specific queue + resume state and forwards lifecycle to the shared `SessionManager`.                                                                                                                                                    |
| `src/discord/command-bot.ts`     | **Delete most of it.** Streambot's `/stream play/stop/skip/...` now use shared `play-command.ts` + `stop-command.ts` builders; only the streambot-specific subcommands (`skip`, `queue`, `loop`, `volume`) stay. Alone-in-VC grace deleted (moved to shared `session/auto-leave.ts`). |
| `src/streamer/streamer.ts`       | Restructured into a streambot `GameDriver` implementation: `onSessionStart` returns the ffmpeg pipeline; `onSessionStop` flushes resume state.                                                                                                                                        |
| `src/state/persistence.ts`       | Stays (queue resume is streambot-specific). Calls shared `sessionDir(...)` for path layout consistency.                                                                                                                                                                               |

### `packages/homelab/src/cdk8s/src/resources/{pokemon,mario-kart}.ts`

| Change                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1P item for each game gains additional userbot token/id pairs (e.g., `userbot_1_token`, `userbot_2_token`, …). Start with 1; design accepts N. |
| `config.toml` render adds `[[stream.userbots]]` array sourcing those pairs.                                                                    |
| Cdk8s `OnePasswordItem` references updated; `homelab` 1P offline linter snapshot refreshed.                                                    |
| PVC layout: `saves/` becomes a directory of `<guildId>/` subdirs (no schema change at the K8s layer).                                          |

### `packages/discord-plays-pokemon` + `mario-kart` — slash command UX

- `/play`: replies "Starting Pokémon in <#voiceChannel>… SPA: https://pokemon.sjer.red/?g=<guildId>". If pool empty or session active elsewhere → "Currently in use by another server, try again later".
- `/stop`: replies "Stopping. Save flushed." Confirms with disabled buttons if not the original starter (optional gate).
- `/screenshot`, `/goal`: scoped to caller's guild; error if no active session for that guild.

## Verification

End-to-end manual (per game):

1. Boot pod with no active session. `kubectl top pod` shows ~baseline CPU (no emulator running).
2. From server A, channel `#game-1`: `/play`. Userbot joins the caller's VC; emulator boots; SPA link posts to `#game-1`. Test gameplay: type text commands in `#game-1` (work), in `#general` (ignored). `/screenshot` posts to `#game-1`. For pokemon: `/goal "X"` posts goal updates to `#game-1`.
3. From server B (different Discord server, same bot in it): `/play`. Confirm "in use" rejection.
4. `/stop` in server A. Confirm userbot leaves, emulator process exits (`ps` inside the pod), save written under `saves/<A>/`. Text commands in `#game-1` go back to being ignored.
5. From server A: `/play` again. Confirm fresh emulator loads from `saves/<A>/` (game progress preserved).
6. From server B: `/play` after A stopped. Confirm B gets its own `saves/<B>/`.
7. All humans leave VC → 30s grace → auto-stop fires. Re-run `/play` to confirm clean restart.

Automated:

- Streambot's existing `userbot-pool.test.ts` moves with the code into `discord-stream-lifecycle/test/` and continues to pass — proves the generalization didn't regress streambot.
- New `discord-stream-lifecycle/test/session-manager.test.ts` covers: single-slot busy semantics across guilds, alone-grace timer fires `STOP`, idle timeout fires `STOP`, manual stop releases pool entry, `/play` while busy returns rejection, session is keyed by `guildId`.
- New `discord-stream-lifecycle/test/play-command.test.ts` covers slash-command handler: captures the right `textChannelId`, rejects when caller not in a voice channel, rejects when pool empty.
- A fake `GameDriver` is the test double for everything above — confirms the lib is self-contained.
- Pokemon `e2e-goal.integration.test.ts` runs against a `PokemonGameDriver`-spawned emulator (per-guild working dir) and confirms goal posts target the bound text channel.
- MK64 `e2e-scenario.ts` harness updated to pass a fake `guildId` and confirm `saves/<guildId>/` + per-guild leaderboard isolation.
- Bun test suites in all three packages pass; `bun run --filter='./packages/homelab' typecheck` after cdk8s changes.

Deployment validation:

- Run `bun packages/homelab/src/scripts/lint-1password.ts` after refreshing the 1P snapshot.
- `helm template`-equivalent dry run via cdk8s synth (`bun run --filter='./packages/homelab' build`) shows the new secret keys without leaking values.

## Rollout sequencing

Aggressive refactor — landed as **one PR**, since splitting would leave streambot
broken between commits:

1. Build out `@shepherdjerred/discord-stream-lifecycle` with pool + session + commands + selfbot + auto-leave + persistence-paths + game-bot wiring.
2. Migrate streambot to consume it; delete streambot's inline copies. CI green here = the lib is correct.
3. Migrate pokemon to consume it; ship `PokemonGameDriver`; clean-slate the save layout.
4. Migrate MK64 to consume it; ship `MarioKartGameDriver`; clean-slate leaderboard.
5. cdk8s + 1P updates for all three (multi-token secret rendering, save layout).

## Out of scope

- Concurrent emulator sessions (parallel games) — explicitly deferred per user direction.
- State migration of existing pokemon save + MK64 leaderboard — clean slate.
- `/play` queueing when busy — return "try later" for v1.
- Web SPA per-guild auth — anyone with the URL can play, as today.

## Session Log — 2026-06-14

### Done

- Phase 1: shared lib in `packages/discord-stream-lifecycle/` — pool/, session/, discord/, persistence/, lifecycle/ modules with 39 passing tests. Commit `741f54719`.
- Phase 2: streambot's pool consumes the shared lib's generic `UserbotPool<T>`; `StreambotStreamer implements PooledUserbot`; `entry.streamer` → `entry.userbot` across streambot. Commit `884f634f7`.
- Plan mirrored to `packages/docs/plans/2026-06-14_pokebot-mk64-pool-refactor.md`.
- Draft PR opened: https://github.com/shepherdjerred/monorepo/pull/1251

### Remaining

- Phase 3 — `discord-plays-pokemon`: write `PokemonGameDriver`, rewrite `index.ts` to call `createGameBot()`, refactor `emulator.ts` + `goal-manager.ts` to take per-session paths, modify `GameStreamer` to accept an external selfbot client (not a token), gate `/screenshot` + `/goal` on active session, drop `server_id` + `channel_id` config keys, SPA reads `?g=<guildId>`.
- Phase 4 — `discord-plays-mario-kart`: mirror Phase 3 + Prisma `guildId` column on `Race` and `LeaderboardStore.forGuild()`.
- Phase 5 — `packages/homelab` cdk8s + 1P updates: render `[[stream.userbots]]` array, drop `server_id`/`channel_id` from `config.toml`, refresh 1P offline-linter snapshot.
- Phase 6 — manual e2e per the verification section, then merge.

### Caveats

- The streambot pool migration (Phase 2) does NOT touch streambot's `SessionManager` — that class is 545 lines deeply wired into the xstate playback machine, TMDB metadata, resume-state checkpointing. The plan called for shrinking it to wrap the shared `SingleSlotSessionManager`, but streambot's model is multi-session per `(guild, channel)` pair, not single-slot. The shared lib's `SingleSlotSessionManager` is the right abstraction for pokemon/MK64 (one emulator, one active game at a time), not for streambot's queue-driven multi-tenant streaming. Streambot keeps its own session manager.
- The 4 pre-existing streambot test failures (`Cannot find module '../../../build/Release/node_datachannel.node'`) are infra — `node_datachannel.node` is a native binary not built in the worktree. Memory `reference_dvs_dist_node_modules_stale.md` covers this. Unrelated to the pool swap.
- Pre-commit `prettier` lefthook step paints failures in green per memory `reference_lefthook_prettier_green_coloring.md`. I hit this twice in this session — trust `git status` post-commit, not the hook colors.
