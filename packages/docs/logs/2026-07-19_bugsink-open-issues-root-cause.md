---
id: log-2026-07-19-bugsink-open-issues-root-cause
type: log
status: complete
board: false
---

# Bugsink Open Issues — Root-Cause Session

## Scope

Reviewed all open (unresolved, unmuted) Bugsink issues across every project: 8 issues in 4 projects (discord-plays-pokemon, discord-plays-mario-kart, scout-for-lol, streambot). 7 of 8 were production; 1 (OpenAI flagged prompt) was beta. Root-caused each via stacktraces/event payloads from the Bugsink API, live cluster state, and six parallel code investigations.

## Findings

### 0. NEW, not in Bugsink: both game bots hard-down — `/app` vs `/workspace` image mismatch

- **Symptom:** `pokemon` and `mario-kart` pods CrashLoopBackOff on `2.0.0-5781` (pokemon: missing `config.toml`; mario-kart: `Module not found "packages/backend/src/index.ts"`). Crashes happen before Sentry init, so Bugsink is blind to them.
- **Root cause:** The new parallel-bake images (post-#1517/#1541) set `WORKDIR /app/packages/discord-plays-<game>` (`packages/discord-plays-pokemon/Dockerfile:147`, `packages/discord-plays-mario-kart/Dockerfile:117`), but the cdk8s deployments still mount config/saves under `APP_ROOT = "/workspace/packages/discord-plays-<game>"` (`packages/homelab/src/cdk8s/src/resources/pokemon.ts:32`, `mario-kart.ts:32`). The old Dagger builds used `.withWorkdir("/workspace/...")`, which matched.
- **Timeline:** last working tag `2.0.0-5498` (07-12, last Dagger build); first broken `5690` (#1543, 07-19); every later tag (5748…5781) broken.
- **Fix:** change `APP_ROOT` to `/app/...` in both cdk8s resources (mario-kart `DATABASE_PATH` derives from it), re-synth, sync.

### 1. discord-plays-{pokemon,mario-kart}: `no userbots could log in: An invalid token was provided`

- **Root cause:** both games' Discord selfbot tokens revoked by Discord (gateway close 4004 on well-formed tokens — anti-selfbot enforcement or simultaneous account resets). First seen June 16–19; separate accounts/1P items (`hwyhh64…` pokemon, `fcugoc3…` mario-kart, vault `v64ocnykdqju4ui6j6pua56xw4`), so no shared-secret explanation.
- `pool.start()` throw (`discord-stream-lifecycle/src/pool/userbot-pool.ts:93`) propagates through a top-level await (`discord-plays-pokemon/packages/backend/src/index.ts:70`) → process exit → k8s restart loop → one Bugsink event per restart (~130 each).
- **Fix:** operator credential rotation — re-auth both userbot accounts, update `config.toml` in both 1P items; if accounts are disabled, new accounts + `userbot-ids.ts` update. No code change. (Blocked on operator; requires Discord account access.)

### 2. scout-for-lol: `Spectator API upstream error for <PUUID>` (168 ev, prod)

- **Not a bug.** Riot Spectator-V5 intermittent 502/503/504, deliberately surfaced by the circuit breaker (`backend/src/utils/circuit-breaker.ts:93-126`): reports only after 5 consecutive failures, max 1 event/15 min. Verified across events: PUUIDs/regions vary (EU_WEST, KOREA, BRAZIL, …) → Riot-wide flakiness, not one player. Grouping uses explicit fingerprint, so the per-PUUID title doesn't fragment issues.
- Prod backend deliberately pinned at `2.0.0-4791` (since 07-03, `homelab/src/cdk8s/src/versions.ts:141`), which is why events carry an "old" release.
- **Optional lever if noise unwanted:** raise threshold / lengthen interval / downgrade to warning in `circuit-breaker.ts`.

### 3. scout-for-lol (beta): OpenAI `400 Invalid prompt … usage policy`

- **Root cause:** AI match-review pipeline sends raw Riot match/timeline JSON for all 10 participants — including arbitrary user-chosen summoner names — to OpenAI reasoning models (`gpt-5.5` / `gpt-5.4-mini`). An offensive Riot ID tripped prompt moderation. Prompt assembly: `data/src/review/pipeline-utils.ts:18-20` (`JSON.stringify(rawMatch)`), `timeline-enricher.ts:37-49`.
- Handled: captured to Sentry (`generator.ts:343-359`), AI review silently dropped, normal report still posts. `markAiAttempted` runs _before_ the pipeline → flagged match never retried.
- **Fix direction:** strip/pseudonymize participant names from prompts (champion+team+participantId suffice); classify policy-flag 400s as a metric, not an error.

### 4. scout-for-lol web (prod): `TypeError: Cannot read properties of undefined (reading 'filters')`

- **Root cause: persistent frontend/backend version skew, live in prod now.** The `filters` feature (#1383, `2b292a5fc`, merged 07-03 15:40) landed ~3.5 h _after_ the commit pinning prod backend to 4791 (`8025054fc`, 07-03 12:05) — verified with `git merge-base --is-ancestor` → backend 4791 predates it. Prod backend's `subscription.list` items lack `filters`; the auto-deployed frontend (5512) reads `sub.filters` unconditionally (`app/src/routes/guild-subscriptions.tsx:236`).
- Compounding defect: `subscriptionFilterQueues` guards `spec === null` but not `undefined` (`data/src/model/subscription-filter.ts:111`) → full render crash for any prod web user viewing a non-empty subscriptions list. Low event count = low page traffic.
- **Fix:** `spec == null` + widen types to `| null | undefined`; and/or unpin/redeploy prod backend past #1383.

### 5. scout-for-lol marketing: `TypeError: Load failed` (Safari/iOS)

- **Root cause:** blocked `ct.pinterest.com` tracking request (status 0) from a Pinterest-ad visit; Safari's generic fetch error. Third-party noise, not app code.
- Marketing site's `beforeSend` (`frontend/src/layouts/Layout.astro:55`) only drops errors matching `/pinterest/i` with a pinterest stack frame — Safari's frameless "Load failed" bypasses it. App SPA Sentry (`app/src/main.tsx:19`) has no filtering at all but doesn't load pixels.
- **Fix:** add `ignoreErrors: [/Load failed/, /Failed to fetch/]` or broaden `beforeSend` on the marketing site.

### 6. streambot (prod): `DiscordAPIError[40060]` (6 ev) + `[10062]` (1 ev)

- **Root cause (40060):** every interaction dispatched fire-and-forget (`void this.safeHandle(interaction)`, no `.catch` — `streambot/src/discord/command-bot.ts:119`); `safeHandle`'s catch re-acks based on `interaction.replied || deferred`, flags that stay false when an ack was delivered but the REST call rejected → blind second `reply()` → 40060 → unhandled rejection (`command-bot.ts:483-491`).
- **Root cause (10062):** event-loop stall under media work (ffmpeg/subtitles on main thread) delays the initial `deferReply` past Discord's 3 s window; same catch then re-replies to the dead token. Secondary: `void handlePaginationClick(...)` (`pagination.ts:66`) un-caught.
- **Fix direction:** guard the catch-block ack, `.catch()` both fire-and-forget sites, treat 40060/10062 as tolerable no-ops.

## Dispositions (user, 2026-07-19)

- **#0 bots down / #1 userbot tokens** — user is handling in a separate work item.
- **#2 spectator upstream** — leave as-is; expected circuit-breaker signal.
- **#3 OpenAI flagged prompt** — leave alone; rare.
- **#4 filters skew** — treated as resolved per-incident; systemic fix planned in [2026-07-19_scout-lockstep-stage-deploys](../plans/2026-07-19_scout-lockstep-stage-deploys.md) (deploy marketing site, backend, and web app in-step per stage).
- **#5 Load failed (Pinterest pixel)** — ignore.
- **#6 streambot interaction errors** — confirmed bug; fix not yet scheduled.

## Session Log — 2026-07-19

### Done

- Enumerated all open Bugsink issues (8 across 4 projects) via `toolkit bugsink`; confirmed environments (7 prod, 1 beta).
- Pulled latest-event stacktraces + payloads (breadcrumbs/tags/request) for all 8 into the session scratchpad.
- Discovered live outage: pokemon + mario-kart CrashLoopBackOff on `2.0.0-5781` (invisible to Bugsink) and root-caused it to the `/app` vs `/workspace` WORKDIR/mount mismatch introduced by the Dagger→bake migration.
- Root-caused all 6 distinct failure modes (above) via 6 parallel subagent investigations, with independent verification of the two cross-cutting claims (spectator PUUID/region spread; `merge-base --is-ancestor` for the filters skew).

### Remaining

- No fixes applied (analysis-only session). Actionable next steps, roughly by urgency:
  1. Fix `APP_ROOT` `/workspace` → `/app` in `pokemon.ts` / `mario-kart.ts` (restores both bots).
  2. Rotate both Discord userbot tokens (operator-only: needs Discord logins + 1P edits).
  3. Decide prod backend unpin/redeploy for scout (clears the filters skew) + make `subscriptionFilterQueues` undefined-safe.
  4. Streambot interaction-ack guards; marketing-site Sentry ignore rules; strip summoner names from OpenAI prompts.

### Caveats

- Mario-kart's observed `Module not found` matches the pre-#1517 CMD signature although the tag is post-#1517 — the running image may predate the current Dockerfile CMD; regardless, the `/app` vs `/workspace` fix is the same, but verify the CMD in the 5781 image when fixing.
- Userbot tokens _presumed_ revoked (4004 path proven from code + library; actual 401 not confirmed against Discord). Verify from inside a pod: `curl -H "Authorization: <token>" https://discord.com/api/v10/users/@me` → expect 401.
- The spectator issue and the OpenAI policy-flag issue are working-as-intended signal; resolving them in Bugsink without the noise-reduction levers means they will re-open on the next occurrence.
- Bugsink issues cannot be resolved via the REST API (405); use the web UI bulk-action form if closing any.
