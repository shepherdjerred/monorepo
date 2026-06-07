# Streambot rewrite — first-principles, XState, two-bot

## Status

Complete — shipped in one PR (branch `claude/naughty-carson-2fca27`), including **Revision 2**
(feedback): branded types, real slash commands (any channel, public output to the configured
channel), adult-source blocking with public shaming, Intel VAAPI hardware encoding (on by default,
software fallback), the full gap-feature set (volume, loop/shuffle, remove/move/clear/playnext,
admin permissions, idle/alone auto-disconnect, playlist expansion), and smoke + e2e Dagger tests.
Live deploy is gated on the user creating a Discord **bot** token and adding `BOT_TOKEN` to the
`streambot-config` 1Password item; CI builds/pushes the image and fills the real digest into
`versions.ts`.

### Revision 2 notes

- Slash commands registered guild-scoped on ready; intents reduced to `Guilds` + `GuildVoiceStates`.
- VAAPI via `@dank074` `Encoders.vaapi`; image installs the Intel iHD driver (Debian non-free) +
  ffmpeg; cdk8s requests `gpu.intel.com/i915: 1` (Jellyfin's non-root pattern), `LIBVA_DRIVER_NAME=iHD`.
- The Intel iHD driver is **x86-only**, so the image installs it conditionally
  (`dpkg --print-architecture = amd64`) and downloads the arch-matching yt-dlp static binary
  (`yt-dlp_linux_aarch64` on arm64) — local arm64 (Mac) smoke builds pass with software encoding.
- No **seek/pause** (library exposes only volume+stop) — documented in `FORK.md`.
- e2e (`e2e/run.ts` + Dagger `e2eStreambot`, Secret-passed creds) streams a generated clip into the
  real voice channel; run manually with `dagger call e2e-streambot …`.

## Context

Streambot was running from an external image (`quay.io/ydrag0n/streambot`) whose runtime
yt-dlp-download broke under our non-root securityContext (worked around in PR #1051 + a live
`kubectl` patch), and whose flat file listing couldn't browse a nested Plex/Jellyfin library.
Rather than fork the upstream's boolean-flag state soup, we **rewrote it from first principles** as
a first-party package built/shipped like `birmel`.

## What shipped

**`packages/streambot/` (Bun/TS, strict, 40 unit tests):**

- **XState v5 playback machine** (`src/machine/`) — single source of truth for the lifecycle
  (`idle → joining → resolving → streaming → advance → leaving`, plus `failed` that drops a bad item
  or bails on join-failure with no hot-loop). All I/O is injectable actors → the machine is pure and
  exhaustively unit-tested.
- **Two Discord identities** (modeled on `discord-plays-pokemon`, but ffmpeg not a browser):
  command bot (`discord.js` v14, bot token) translates `$`-commands → machine events; selfbot
  streamer (`discord.js-selfbot-v13` + `@dank074/discord-video-stream` v6, user token) owns the
  voice connection + ffmpeg, driven by the machine's actors (abortable on SKIP/STOP).
- **Strict boundaries (Zod):** config-from-env, source discriminated union, `yt-dlp --dump-json`.
- **Full local-fs support:** recursive library scan (`Bun.Glob`) + ranked fuzzy search over
  `VIDEOS_DIR` + read-only media roots — fixes the upstream flat-listing limit.
- **yt-dlp:** system binary (`Bun.spawn`, abortable); baked into the image, no runtime download.
- Dropped the upstream express/ejs/bcrypt/argon2 web UI entirely.

**Image / CI (`.dagger`, `scripts/ci`):** `withStreambotRuntime` bakes ffmpeg + native build deps
(node-datachannel, node-av) + latest yt-dlp; `smokeTestStreambot` asserts ffmpeg/yt-dlp run, the
machine boots, and Discord login fails as expected; registered in `IMAGE_PUSH_TARGETS`,
`PACKAGE_RESOURCES`, `SMOKE_TEST_FUNCTIONS`, `WORKSPACE_DEPS`, and a new `media` `DEPLOY_TARGET`.

**Homelab (GitOps):** rewrote `resources/streambot.ts` to the first-party ghcr image with the new
env (`BOT_TOKEN` + config vars), read-only `/media/movies` + `/media/tv` mounts, and no
Service/Ingress (Discord-only). **Moved streambot into the `media` namespace** (folded into the
media chart) so it can RO-mount the existing libraries; deleted the standalone chart, ArgoCD app,
and `helm/streambot`. `versions.ts` key `ydrag0n/streambot` → `shepherdjerred/streambot`.

## Decisions (made with the user)

- Full refactor / clean rewrite before shipping (not a fork).
- Bake ffmpeg + system yt-dlp (retires the runtime download and PR #1051).
- Two-identity split; pause/resume deferred (continuous video pause is unreliable; upstream has
  none) — `ADD`/`SKIP`/`STOP` + queue only.
- New `BOT_TOKEN` for the command bot (user creates it).
- Move streambot into the `media` namespace for clean RO library mounts.

## Verification

- `packages/streambot`: `bun test` (40), `tsc`, `eslint`, prettier — all green; entry point boots
  and fail-fasts on missing config (native deps load).
- Homelab: typecheck, helm-lint (media chart), versions-validate, dagger-hygiene, 361 tests, ratchet
  — all green via pre-commit.
- Runtime (selfbot + ffmpeg streaming) validates at deploy via the smoke test + a manual stream
  check — it can't run on macOS (WebRTC native module is Linux-only) and needs real tokens.

## Caveats / next

- **Blocked on the user:** create the Discord bot, add `BOT_TOKEN` (and confirm the existing
  `streambot-config` keys) so the pod starts.
- First deploy: CI's version commit-back replaces the seed digest in `versions.ts`; the old
  `streambot` namespace is pruned by ArgoCD when the standalone app disappears.
- Selfbot (`discord.js-selfbot-v13`) is ToS-gray (pre-existing); isolated behind `src/streamer/`.

## Session Log — 2026-06-06

### Done

- Made the VAAPI image arch-aware in `.dagger/src/image.ts` `withStreambotRuntime`: install
  `libva2`/`libva-drm2`/`vainfo` always; install the x86-only `intel-media-va-driver-non-free`
  only when `dpkg --print-architecture = amd64`; download the arch-matching yt-dlp static binary
  (`yt-dlp_linux` on amd64, `yt-dlp_linux_aarch64` on arm64). Fixes the local arm64 smoke-build.
- Verified locally: `dagger call smoke-test-streambot …` **passes** on arm64 (failed-with-expected-
  auth-error). Removed a stray `.dagger/bun.lock` (the module is npm-based).
- All gates green: streambot `bun test` (51), `tsc`, `eslint`; homelab typecheck + `test-gpu-resources`
  (3 i915 in media: plex/jellyfin/streambot); dagger-hygiene; full pre-commit (tier-1 + tier-2).
- Committed `729e4deb1` and pushed to PR #1056 (branded types, slash commands, adult-block, VAAPI,
  queue features were already in `d1ccc279e`; this commit adds the image VAAPI stack, GPU request,
  and the Dagger e2e func + `e2e/run.ts`).
- **Nested all commands under a single `/stream` parent** (`4c85dc297`): `commands.ts` is now one
  `SlashCommandBuilder("stream")` with 14 `addSubcommand` entries (`/stream play`, `/stream skip`,
  `/stream queue`, …); `command-bot.ts` `handle()` switches on `interaction.options.getSubcommand()`.
  Docs/FORK updated. Tests/tsc/eslint green.
- **Wired the bot token into the deployment secret:** moved the Discord **bot** `TOKEN` from the
  `Glidiot Helper` 1P item into `streambot-config` as `BOT_TOKEN` (72 chars) and deleted it from the
  source so it isn't duplicated. `streambot-config` now holds every key the cdk8s resource reads
  (`BOT_TOKEN`, `TOKEN`, `GUILD_ID`, `COMMAND_CHANNEL_ID`, `VIDEO_CHANNEL_ID`, `ADMIN_IDS`); the
  1Password operator will sync a complete secret. (`APPLICATION_ID` isn't needed — the bot reads its
  app id from the logged-in client.)

- **Ran the live Dagger e2e (PASS) against a dedicated test guild** (`1337623164146155593`, voice
  `1337623164955398253`, text `1337631455085334650`) — see `project_streambot_e2e_test_server`
  memory. It now exercises **both identities**: the command bot logs in (as `Glidiot Helper`) and
  registers the `/stream` command on the guild; the userbot (`glidiot_`) joins the voice channel,
  reaches `streaming`, holds, and stops cleanly. Two real bugs were found+fixed in the process:
  - `runStream` ended the stream at ffmpeg-_encode_ completion (~0.5s for a local file) instead of
    real-time playback — would cut every video short. Now awaits `playStream`; the ffmpeg promise
    only surfaces failures (`2a6159595`).
  - selfbot `Client.destroy()` threw on a null gateway connection and masked a passing e2e as exit 1
    — now guarded (`2a6159595`).
  - Added `CommandBot.ready` + debounced the "alone in VC" auto-leave behind a 30s grace so a
    transient empty channel (or an unattended e2e) doesn't drop playback (`4183b580b`).

### Remaining

- Merge PR #1056; CI commit-back fills the real `shepherdjerred/streambot` digest in `versions.ts`,
  then ArgoCD deploys to the `media` namespace. After deploy, confirm the pod is `1/1` and run a
  manual `/stream play <library title>` smoke check in Discord.

### Caveats

- lefthook renders a failed `prettier` step with the same green-ish coloring as a pass — the hook
  exit code (1) is the source of truth. `e2e/run.ts` needed `prettier --write` before it would commit.
- HW encoding only engages on the amd64 cluster (the iHD driver isn't installed on arm64); local/dev
  builds silently fall back to software encoding (`STREAM_HARDWARE_ACCELERATION` still defaults true
  in prod, false in the e2e helper).
