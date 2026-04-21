# Loading Screen Resilience Audit

**Date:** 2026-04-20
**Context:** After fixing the queue 2400 + Rek'Sai 404 bugs on `scout-beta` (image `2.0.0-966`), an audit of how resilient the loading-screen pipeline is to future Riot/twisted changes.
**Status:** Reactive defenses landed; structural hardening tracked as follow-ups.

## Summary

What we shipped on 2026-04-20 fixes the immediate production failures and hardens against the same class of bug for every champion currently on disk. It does **not** structurally prevent the next champion release or the next rotating queue from causing the same outage. The override map and queue enum are still manually maintained; only the test grid catches drift, and only for champions/queues we already know about.

## What is protected today

| Protection                  | Mechanism                                                                                                                                                                           | What it catches                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Override-map → on-disk file | Table-driven test in `packages/data/src/data-dragon/images.test.ts` iterates every `championNameOverrides` entry through `validateChampionImage` and `validateChampionLoadingImage` | Typos in overrides; missing on-disk asset for any overridden champion                      |
| Twisted output drift        | 16 explicit `resolveChampionKey(id)` cases in `packages/backend/src/utils/champion.test.ts` and `champion-resolver.test.ts`                                                         | Twisted version bump that changes the SCREAMING_SNAKE_CASE format for any current champion |
| Exhaustive queue match      | `queueTypeToDisplayString` uses `.exhaustive()` over `QueueTypeSchema`                                                                                                              | Adding a value to the enum without a display string fails typecheck — can't be missed      |
| Unknown queue ID            | `parseQueueType` logs `unknown queue type: <id>` to stderr; `buildLoadingScreenData` throws                                                                                         | Loud failure in pod logs + Sentry within minutes of a new queue appearing                  |
| Live CDN match              | Smoke test (one-off, not in CI) confirmed Riot's CDN serves every override target at 200 OK                                                                                         | Drift between our local cache and Data Dragon's actual filenames                           |

## What is still fragile

### 1. New camelCase champions

Every new release that produces a camelCase Data Dragon filename (`AmbessaMedarda`, future `BelVeth`-style names) **may** trigger the same 404 if twisted's format is inconsistent with our PascalCase round-trip. The override map is reactive — we discover the bug in production and add a row.

### 2. New rotating queues

Riot rotates ARAM/event queues regularly. Queue 2500, 2600, etc. will hit the **same** hard-throw at `loading-screen-builder.ts:170` that 2400 did. Notification skipped, full embed lost.

### 3. `searchChampions` apostrophe gap

Pinned by a test (`packages/backend/src/utils/champion.test.ts` — "current gap: Rek'Sai apostrophe/space queries miss") but not fixed. Discord autocomplete for `rek'sai` returns nothing. Triggers when Riot stores a champion as `REKSAI` (no underscore) but the user types apostrophe-or-space form.

### 4. Twisted version drift in CI

We have unit tests, but no gate that runs them against the _latest_ twisted on every Renovate bump. A subtle behavior change in twisted could pass our pinned-version tests but break in prod after the upgrade lands.

### 5. Champion data file silently empty

`getChampionList()` at `packages/data/src/data-dragon/champion.ts:57-81` swallows any error and returns `[]`. The repo doesn't ship `assets/champion.json` (only `assets/champion/` directory), so this returns empty in production — completely hidden by the bare `try/catch`. Discovered while writing tests, not in scope for this PR.

## Hardening follow-ups (priority order)

### P1 — Auto-generate the override map

During `bun run update-data-dragon`, after downloading every asset, enumerate every champion ID twisted knows about, compute both possible PascalCase forms (with-underscore and without-underscore from twisted's output), compare against the on-disk filename, and write any mismatch into `championNameOverrides`. Eliminates the manual step and the next-release failure mode.

**Where:** `packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts`
**Output:** Generated `championNameOverrides.generated.ts` imported by `images.ts` (committed, not gitignored, so reviewers see what changed when assets are refreshed).

### P2 — Startup assertion

Add a `validateChampionAssets()` call to backend startup. Iterates every champion ID twisted knows, calls `resolveChampionKey(id)`, then `validateChampionImage(key)` + `validateChampionLoadingImage(key, 0)`. Crash the pod on any miss.

**Why:** A bad override map can never reach production; the failure happens at deploy, not at notification time. Pairs naturally with P1.
**Cost:** ~170 file existence checks at startup — tens of milliseconds with `Bun.file().exists()`.
**Where:** new `validateChampionAssets()` in `packages/backend/src/league/data-dragon/`, called from the same place that loads other startup config.

### P3 — Soften the queue hard-throw

At `packages/backend/src/league/tasks/prematch/loading-screen-builder.ts:163-173`, instead of throwing, fall back to `gameInfo.gameMode` (e.g., "ARAM", "CLASSIC") for the display name and emit a structured Sentry event with the unknown queue ID. The notification still ships — the user gets a slightly worse title, the team gets a paged alert, the world doesn't end.

**Trade-off:** Loses fail-fast loudness. Mitigated by the Sentry event being page-worthy rather than log-buried.

### P4 — Branded `ChampionKey` type

Already in the original plan's Part 3. Introduce `z.string().brand<"ChampionKey">()` in `packages/data/src/model/`. Retype every consumer (`validateChampionImage(name: ChampionKey)`, `LoadingScreenParticipantSchema.championName: ChampionKeySchema`, etc.). Forces normalization at every inbound boundary at compile time. Larger refactor — separate plan.

### P5 — Weekly Riot `queues.json` sync check

Cron job (Buildkite scheduled pipeline or GitHub Action) that fetches `https://static.developer.riotgames.com/docs/lol/queues.json`, diffs against `QueueTypeSchema` in `state.ts`, and opens an issue when Riot adds a queue we don't know about.

### P6 — Fix `searchChampions` apostrophe

Trivially: build a second alias map from each champion's display name → ID (apostrophe + space + hyphen-stripped) and merge into `CHAMPION_NAME_TO_ID`. Test already exists as a "known gap" — flip it to assert the working case.

### P7 — Investigate empty `champion.json`

`getChampionList()` returns `[]` because the file isn't present in the asset directory. Either populate it during `update-data-dragon` or delete the function if it's unused. Currently masked by a bare `catch`.

## How resilience changes after each step

| After            | New camelCase champ                                | New queue ID                    | Twisted drift           | Apostrophe lookup          |
| ---------------- | -------------------------------------------------- | ------------------------------- | ----------------------- | -------------------------- |
| Today (post-fix) | Reactive (prod 404, then add override)             | Reactive (prod throw, then add) | Caught by tests on bump | Broken for affected champs |
| + P1             | Self-healing (next `update-data-dragon` covers it) | Reactive                        | Caught by tests         | Broken                     |
| + P1, P2         | Self-healing + caught at startup                   | Reactive                        | Caught at startup       | Broken                     |
| + P1, P2, P3     | Self-healing                                       | Degraded notification + page    | Caught at startup       | Broken                     |
| + P1, P2, P3, P4 | Self-healing + type-system gate                    | Degraded + paged                | Type error at compile   | Broken                     |
| + P5             | Self-healing                                       | Caught a week early             | Type error at compile   | Broken                     |
| + P5, P6         | Self-healing                                       | Caught a week early             | Type error at compile   | Fixed                      |

## Verification

The base fix was smoke-tested against real APIs on 2026-04-20:

- Live Riot Data Dragon (`/api/versions.json`, `champion.json`) confirmed every override target matches Data Dragon's `id` field for the 14 trouble champions.
- Live Riot CDN HEAD requests returned 200 for `/champion/RekSai.png` and `/champion/loading/RekSai_0.jpg`.
- Live `https://static.developer.riotgames.com/docs/lol/queues.json` confirmed queue 2400 = "ARAM: Mayhem" on Howling Abyss.
- End-to-end render via `buildLoadingScreenData` → `loadingScreenToImage` produced a 2.78 MB PNG with title "ARAM MAYHEM" and all five trouble champions (Rek'Sai, KSante, Jarvan IV, Wukong, Fiddlesticks) correctly displayed.

84/84 smoke checks passed. Smoke scripts were not committed.
