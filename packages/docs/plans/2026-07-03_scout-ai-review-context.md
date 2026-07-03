# Scout for LoL — Richer AI Reviews: Patch Notes + Player History

## Status

Complete (implemented on branch `feature/scout-ai-review-context`, not yet merged). All
typecheck / lint / tests green across data, backend, temporal, and frontend. See the Session
Log at the bottom for the exact files and follow-ups.

## Context

The AI review feature (a personality "roasts" your match in a group-chat voice) currently
only sees **the single match being reviewed** — a match-summary text, a timeline-summary
text, rank change, queue, and who else was in the game. It has no memory of the player's
recent form and no awareness of the current patch. That makes it impossible to write the
kinds of notes the user wants:

- "Wow, you're on a losing streak" → needs recent W/L history
- "You aren't good at champion X, go back to your main" → needs champion pool + per-champ winrate
- "You belong in bronze" → rank/percentile already exists, but lands harder with recent-form context
- "X got gutted this patch" → needs current patch notes

This plan adds two new **context strings** to the review-text stage (Stage 2):

1. **Patch notes** — highlights of the current League patch.
2. **Player history** — recent games, champion pool, main lane, current streak, recent winrate.

Both are fed into the personality prompt so any personality can reference them naturally.
The review pipeline in `packages/data` is platform-agnostic and already accepts pre-built
context strings (`matchAnalysis`, `timelineSummary`); we extend that same seam.

## Architecture at a glance

- The pipeline (`generateFullMatchReview`, `packages/data/src/review/pipeline.ts`) is pure — it
  receives context strings via `input.prompts`. We add two optional fields there.
- **Player history is DB-driven**, so it is built in the **backend** (which has Prisma) and
  passed in — exactly like nothing-crosses-into-data-except-strings today.
- **Patch notes are a bundled asset** in the `data` package, written by the existing
  Data Dragon update automation (which already generates patch highlights) and read at
  review time with zero runtime cost.

All new prompt context flows into the **user** prompt of Stage 2 (`user/2-review-text.txt`),
alongside the existing dynamic blocks (queue/rank/friends/match-analysis).

---

## Feature 1 — Patch notes context (structured changeset)

The existing `generatePatchHighlights` only produces 2–4 marketing-level bullets — too coarse
to drive "your champ got buffed" callouts. Redesign: the Data Dragon workflow **saves the raw
patch notes and extracts a detailed, structured changeset**, and reviews **cross-reference that
changeset against the reviewed player's champions / role / items** to produce a targeted patch
block.

### Ingest (extend the existing Temporal Data Dragon workflow)

The workflow that already updates Data Dragon on a patch is
`packages/temporal/src/activities/data-dragon.ts` → `bun run update-data-dragon`, which on a
minor version bump calls `maybeAppendChangelogEntry()` (`data/scripts/update-data-dragon.ts`
~L930) and today invokes `generatePatchHighlights` (`data/scripts/patch-highlights.ts`,
`claude -p` + WebFetch). Extend this path:

1. **Save the raw notes.** Fetch the patch-notes page (`patch.url` from `riot-patch.ts`, via
   WebFetch / `toolkit fetch` → markdown) and write the raw markdown to a committed **archive**
   file `packages/data/patch-notes-archive/<patch>.md` (provenance + re-analyzable; NOT imported
   at runtime, so it doesn't bloat the shipped bundle).
2. **Extract a structured changeset.** Replace/expand `generatePatchHighlights` with a detailed
   analysis pass (`data/scripts/patch-analysis.ts`) that feeds the saved raw notes to `claude -p`
   (use a stronger model than haiku, e.g. `claude-sonnet` — patch-cadence job, cost negligible)
   and returns a Zod-validated changeset:

   ```ts
   const DirectionSchema = z.enum([
     "buff",
     "nerf",
     "adjustment",
     "new",
     "removed",
   ]);
   const MagnitudeSchema = z.enum(["minor", "moderate", "major"]);
   // reusable rich change entry: short label + free-form prose "why it matters"
   const ChangeSchema = z.object({
     direction: DirectionSchema,
     magnitude: MagnitudeSchema,
     summary: z.string(), // one-liner, e.g. "Q base damage up"
     details: z.string(), // prose: what changed AND why it matters to a player
   });
   const PatchChangesetSchema = z.object({
     patch: z.string(),
     title: z.string(),
     url: z.string(),
     date: z.string(),
     overview: z.string(), // FREEFORM prose narrative of the whole patch
     themes: z.array(z.string()).default([]), // e.g. ["ADC item overhaul","jungle buffs"]
     summary: z.array(z.string()).min(2).max(4), // short highlight bullets (feeds the changelog)
     champions: z.array(ChangeSchema.extend({ name: z.string() })),
     items: z.array(ChangeSchema.extend({ name: z.string() })),
     systems: z.array(ChangeSchema.extend({ area: z.string() })), // "Jungle","Objectives","Runes"…
   });
   ```

   - `overview` is the freeform patch summary — a few sentences of narrative the reviewer can
     draw on even when no specific change touches the player.
   - Each change carries prose `details` + a `magnitude`, so the filter can prioritize _major_
     changes and the reviewer has real substance ("why it matters"), not just "buffed".
   - Champion/item names normalized on read via `normalizeChampionName` / `getChampionKeyById`
     (`data/src/data-dragon/`) so they match `MatchParticipantFact.championName` and item assets.

3. **Persist the bundled changeset asset** `packages/data/src/data-dragon/assets/patch-notes.json`
   (the whole changeset). Seed an initial valid file in this PR so the import resolves immediately.
4. **Changelog reuse (no regression).** `buildPatchChangelogEntryLiteral` now consumes
   `changeset.summary` instead of the old highlights array — one analysis pass feeds both the
   "What's New" changelog and reviews.
5. **Commit both artifacts.** Add `assets/patch-notes.json` **and** the
   `patch-notes-archive/<patch>.md` path to `GENERATED_PATHS` in
   `temporal/src/activities/data-dragon.ts` (staged by explicit path; repo bans `git add -A`).

### Reader + relevance filter (data package) — `data-dragon/patch-notes.ts`

```ts
import changesetRaw from "./assets/patch-notes.json" with { type: "json" };  // like version.ts
export function getPatchChangeset(): PatchChangeset | undefined { … }         // Zod-validated
// pure: keep changes touching the player's champs/role/items, ranked by magnitude
export function selectRelevantPatchChanges(cs, { champions, lanes, items }): PatchChangeset;
// pure: render targeted changes (prefer major, include prose `details`); if none match,
// fall back to the freeform `overview` + a couple of `summary` bullets. "" only if no changeset.
export function formatPatchNotes(cs, subset): string;
```

`selectRelevantPatchChanges` / `formatPatchNotes` are pure and unit-testable. `formatPatchNotes`
leans on `details` prose for relevant changes and on `overview` when the player isn't specifically
affected, so the block is never empty when a changeset exists.

### Cross-reference at review time (backend)

The backend already assembles dynamic context (and, per Feature 2, the player's champion pool +
lane). In `generator.ts`, gather the reviewed player's **this-game champion + pool champions
(from the history signals) + lane + items** (item IDs from `rawMatchData` participant
`item0..6`, mapped to names via `data-dragon/item.ts`), call
`selectRelevantPatchChanges(getPatchChangeset(), …)` → `formatPatchNotes(…)`, and pass the result
as `prompts.patchNotes`. Result reads like:

```
PATCH 26.13 — Darius: buffed (Q base damage up). Your build: Eclipse nerfed (AD reduced).
Jungle: objectives give more gold — role is stronger this patch.
```

The frontend review-tool gets the general `summary` bullets (no player context) — still valid.

### Simplification (accepted)

Inject the **latest** patch, not the match's exact `gameVersion` (reviews run on the current
patch, so latest ≈ match patch). Noted, not solved.

---

## Feature 2 — Player history context

The key change from the first draft: don't hand the LLM a loose prose blob — compute a
**structured, preprocessed `PlayerHistorySignals` object** (typed + Zod), then render it as a
clean **labeled** block. Labeled facts ("current streak: 4 losses") are far more reliable for
the model than making it re-derive them from a game list.

### Data sources

- `MatchParticipantFact` (backend Prisma, `packages/backend/prisma/schema.prisma`) — one row per
  tracked account per processed match, written by `upsertStoredMatchWithFacts`
  (`src/report-store/store.ts`) on every postmatch. Fields: `championId`, `championName` (already
  resolved), `win`, `kills/deaths/assists`, `kda`, `creepScore`, `goldEarned`, damage/vision,
  `queueId`/`queue`, `gameCreationAt`, `playerId`, `serverId`, `puuid`, `teamId`,
  `rawParticipantJson`. Index `[serverId, playerId, gameCreationAt]` is ideal.
- `MatchRankHistory` (keyed by `puuid` + `queueType`, `rankBefore`/`rankAfter` JSON,
  `matchGameEndAt` index) → rank-N-games-ago and LP-over-time.
- **Cross-tracked-player synergy:** two tracked players in the same game share a `matchId`;
  join their fact rows on `matchId` + same `teamId` → duo winrates.
- **Lane** is not a column → parse `teamPosition` from `rawParticipantJson` (small loose Zod
  parse), reusing the `teamPosition → lane` mapping from `toMatch`
  (`packages/data/src/model/match.ts`).
- No Champion Mastery API call — recent-form aggregation captures current form/streaks that
  lifetime mastery cannot.

### Derived signals — the menu (enumerated)

**Phase 1 = every ✅ row below** (Core + performance trends). All Phase-1 signals come from ≤3
queries (facts window, rank history, co-tracked facts) — no raw-match scanning. The two
`Follow-up` rows are deferred (they need scanning `StoredMatch.rawJson` per past game or add
little). "This game" = the match being reviewed.

| Signal                                                                         | Source                     | Tier                     |
| ------------------------------------------------------------------------------ | -------------------------- | ------------------------ |
| `currentLossStreak` / `currentWinStreak` (consecutive)                         | facts                      | ✅ Core                  |
| `lastTenRecord` (e.g. 3W-7L) + `recentWinrate` (last 20)                       | facts                      | ✅ Core                  |
| `longestLossStreakInWindow`                                                    | facts                      | Stretch                  |
| `gamesToday` / `gamesThisWeek`                                                 | facts (`gameCreationAt`)   | ✅ Core                  |
| `gamesLastHour` (session length / tilt) · `daysSinceLastPlayed`                | facts                      | Stretch                  |
| `rankNow` (exists via rank ctx) + `rankNGamesAgo` (10) → net tier/LP           | rank history               | ✅ Core                  |
| `lpThisWeek` (net) · `lpToday` · `peakRankInWindow`                            | rank history               | ✅ Core (week) / Stretch |
| Champion pool: top 3–5 champs w/ games + winrate                               | facts                      | ✅ Core                  |
| This-game champ: off-pool flag + record/winrate on it + first-time             | facts                      | ✅ Core                  |
| `mainLane` (mode + %) + this-game **off-role** flag                            | facts (teamPosition)       | ✅ Core                  |
| Per-role winrate                                                               | facts                      | Stretch                  |
| Avg KDA / CS-per-min / vision vs **this** game (over/under-performed)          | facts                      | ✅ Core                  |
| Best/worst champ by winrate (min games) · one-trick vs flex                    | facts                      | ✅ Core                  |
| Duo winrate with each other tracked player · with teammate(s) **in this game** | co-tracked facts           | ✅ Core                  |
| Solo vs premade winrate · most-frequent teammate                               | co-tracked facts           | Stretch                  |
| Head-to-head winrate vs this lane opponent's champion                          | scan `StoredMatch.rawJson` | Follow-up                |
| Time-of-day winrate (late-night tilt)                                          | facts                      | Follow-up                |

Timezone for "today/this week": use `America/Los_Angeles` (repo convention) — note in code.

### New backend module — `src/league/review/player-history.ts`

Three parts (keep aggregation pure/testable — DB in, `PlayerHistorySignals` and text out):

1. **Identity + fetch (DB):** resolve puuid → `(serverId, playerId)` via
   `prisma.account.findMany({ where: { puuid }, include: { player: true } })` (scope to
   `targetServerIds` when provided), then pull the facts window
   (`matchParticipantFact.findMany`, `orderBy gameCreationAt desc`, `take 20–30`,
   `matchId: { not: currentMatchId }`), the rank-history rows, and the co-tracked facts for the
   duo signals. Mirrors `findTrackedAccounts` (`store.ts`) and `report-store/queries.ts`.
2. **Pure aggregator** `computePlayerHistorySignals(input): PlayerHistorySignals` — no DB; takes
   the fetched rows + the current match's champion/lane/teammates and computes the Core signals
   above. Fully unit-testable with synthetic rows. Define `PlayerHistorySignalsSchema` (Zod).
3. **Pure formatter** `formatPlayerHistory(signals): string` — renders the labeled block
   (RECENT FORM / RANK / CHAMPS / DUOS lines). Empty window → `""` (prompt falls back).

### Wiring into the review

`generateMatchReview` (`src/league/review/generator.ts`) selects the player _internally_
(`selectPlayerIndex`), so history is built there after selection using the selected player's
`playerConfig.league.leagueAccount.puuid`.

- The current call site
  `generateMatchReview(completedMatch, matchId, matchData, timelineData)` in
  `src/league/tasks/postmatch/match-report-ai-review.ts` passes 4 positional args.
  Adding server scope would make it 5 → violates ESLint `max-params: 4`. **Refactor
  `generateMatchReview` to a single options object** `{ match, matchId, rawMatchData,
timelineData, targetServerIds? }` and update the one caller (pass `targetGuildIds`).
- Inside `generateMatchReview`, after selecting the player, call the history module
  (fetch → `computePlayerHistorySignals` → `formatPlayerHistory`) and pass the resulting
  labeled string into the pipeline as `prompts.playerHistory`. Wrap in try/catch — a history
  failure must never block the review (Sentry + fall back to empty).

---

## Shared wiring — thread both strings into Stage 2

Add two **optional** fields to `PipelinePromptsInput`
(`packages/data/src/review/pipeline-types.ts`): `playerHistory?: string`, `patchNotes?: string`
(optional → frontend review-tool and any other caller keep compiling; `exactOptionalPropertyTypes`
is on, so assign conditionally).

Thread them the same way `laneContext`/`timelineSummary` already flow:

| File                                                                   | Change                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/src/review/pipeline-types.ts`                                    | Add `playerHistory?` / `patchNotes?` to `PipelinePromptsInput`                                                                                                                            |
| `data/src/review/pipeline.ts` (~L376)                                  | In `reviewTextParams`, conditionally pass `playerHistory` / `patchNotes` from `input.prompts`                                                                                             |
| `data/src/review/pipeline-stages.ts` (`generateReviewTextStage`)       | Add the two to params; forward to `buildPromptVariables`                                                                                                                                  |
| `data/src/review/generator-helpers.ts` (`buildPromptVariables`)        | Add params + return keys; fallback for history = "No recent match history available."; patch fallback = `overview` + `summary` via `getPatchChangeset()` else "No patch notes available." |
| `data/src/review/prompts.ts` (`replaceTemplateVariables`)              | Add `playerHistory` / `patchNotes` to the param type **and** add the two `.replaceAll("<PLAYER HISTORY>", …)` / `.replaceAll("<PATCH NOTES>", …)` calls                                   |
| `data/src/review/prompts/user/2-review-text.txt`                       | Add `<PLAYER HISTORY>` and `<PATCH NOTES>` blocks + style lines permitting references to recent form / patch                                                                              |
| `backend/src/league/review/generator.ts`                               | Options-object refactor; build player-history signals; build targeted patch notes (champs/pool/lane/items); set `prompts.playerHistory` + `prompts.patchNotes`                            |
| `backend/src/league/review/player-history.ts` (new)                    | DB fetch + `computePlayerHistorySignals` (pure, Zod-typed) + `formatPlayerHistory`                                                                                                        |
| `backend/src/league/tasks/postmatch/match-report-ai-review.ts`         | Update the single call site to the options object, pass `targetGuildIds`                                                                                                                  |
| `data/src/data-dragon/patch-notes.ts` (new)                            | `getPatchChangeset()` (Zod) + pure `selectRelevantPatchChanges` + `formatPatchNotes`                                                                                                      |
| `data/src/data-dragon/assets/patch-notes.json` (new)                   | Seed structured changeset asset                                                                                                                                                           |
| `data/scripts/patch-analysis.ts` (new, replaces `patch-highlights.ts`) | `claude -p` structured changeset extraction over saved raw notes                                                                                                                          |
| `data/scripts/update-data-dragon.ts`                                   | Save raw notes to archive; run analysis; write changeset asset; feed `changeset.summary` to changelog                                                                                     |
| `data/patch-notes-archive/<patch>.md` (new dir)                        | Raw notes provenance (not imported)                                                                                                                                                       |
| `temporal/src/activities/data-dragon.ts`                               | Add `patch-notes.json` + archive path to `GENERATED_PATHS`                                                                                                                                |

**Caution (known footgun):** `replaceTemplateVariables` (the user-prompt path) does **no**
validation — a forgotten `.replaceAll` silently leaks `<PLAYER HISTORY>` into the model prompt.
Double-check both `.replaceAll`s are added.

**Monorepo caveat:** after editing `packages/data`, run `bun install` at
`packages/scout-for-lol/` to re-copy the `file:` dep into backend/frontend `node_modules`,
or their typecheck sees stale `data` types.

---

## Prompt content sketch (`user/2-review-text.txt`)

Insert before the final Writing Style block:

```
This block describes <PLAYER NAME>'s recent form and history (may be empty):
---
<PLAYER HISTORY>
---

This block describes the current League patch (may be empty):
---
<PATCH NOTES>
---
```

`<PLAYER HISTORY>` renders as the labeled signal block, e.g.:

```
RECENT FORM — Current streak: 4 losses · Last 10: 3W-7L (30%) · Today: 6 games · This week: 21
RANK — Now: Silver II (42 LP, bottom ~45%) · 10 games ago: Gold IV (-1 tier, -180 LP this week)
CHAMPS (last 20) — Main: Lee Sin 9g/56%, Viego 5g/40% · This game: Yasuo (off-pool, 1-4 / 20%)
PERFORMANCE — This game KDA 2.1 vs their avg 3.4 (below); CS/min 5.8 vs avg 6.9
DUOS — with Colin 8-2 (80%) · with Danny 4-6 (40%)
```

`<PATCH NOTES>` renders the targeted subset with prose (champs/role/items touching this player),
falling back to the freeform `overview` when nothing specific matches:

```
PATCH 26.13 — This patch reins in snowball ADCs and hands junglers a stronger early game.
Yasuo (nerf, major): windwall cooldown up 4s — his lane bully phase is noticeably weaker now.
Jungle (buff, moderate): objective gold up — clearing and contesting pays off more.
Your build — Eclipse (nerf): AD reduced; the item's less of a spike than last patch.
```

Add to Writing Style:

- "If their recent form stands out (a streak, playing off their usual champs/lane, a big rank
  gap, a strong/weak duo record), feel free to call it out in character."
- "Only mention the patch if it's genuinely relevant to what happened."

---

## Verification

1. **Unit tests (pure):**
   - `player-history.test.ts` — feed synthetic fact/rank/co-tracked rows to
     `computePlayerHistorySignals`; assert loss/win-streak, last-10 record, gamesToday/thisWeek,
     rank-N-games-ago, champion-pool ordering + off-pool flag, main-lane mode + off-role flag,
     duo winrates; then `formatPlayerHistory` snapshot + empty-input → `""`.
   - `patch-notes.test.ts` — changeset asset parses (Zod); `selectRelevantPatchChanges` keeps
     only changes matching given champs/lane/items and drops the rest; `formatPatchNotes`
     snapshot; no-match → `overview` + `summary` fallback; ranks major changes first;
     missing changeset → `""`.
   - `patch-analysis.test.ts` — the structured-extraction parser validates a sample notes page
     into the changeset schema (off-spec output fails validation).
2. **Typecheck/lint:** `bun run typecheck` + `bunx eslint .` in `data` and `backend`
   (watch `max-params`, `no-type-assertions`, Zod-naming). Run `bun install` at scout root first.
3. **End-to-end (review tool):** use the frontend review tool
   (`packages/frontend/src/lib/review-tool/`) or `dev:web` to generate a review and eyeball that
   the history/patch context appears in the Stage-2 trace and influences the text. Optionally add
   temporary textareas in the review tool to inject sample history/patch strings.
4. **Backend smoke:** run the postmatch path against a tracked player with existing
   `MatchParticipantFact` rows; confirm `prompts.playerHistory` is populated (S3 trace) and the
   `<PLAYER HISTORY>` placeholder is fully replaced (not leaked).
5. **PR media:** include a before/after of a generated review showing a history/patch callout
   (per repo PR-media convention).

## Out of scope / follow-ups

- **Head-to-head vs this lane opponent's champion** — deferred; needs scanning
  `StoredMatch.rawJson` per past game (opponents aren't denormalized in `MatchParticipantFact`).
- **Time-of-day winrate**, solo-vs-premade, per-role winrate, longest-loss-streak, session
  length — remaining Stretch signals, easy to add later over the same query results.
- Champion mastery API (`ChampionMasteryV4`) — not needed; recent-form aggregation is better.
- Per-match exact patch matching — using latest patch is sufficient.
- Surfacing history/patch in the rendered match image — this plan only feeds the AI text.

## Session Log — 2026-07-03

### Done

- **Pipeline threading (data):** added optional `playerHistory?` / `patchNotes?` to
  `PipelinePromptsInput` (`packages/scout-for-lol/packages/data/src/review/pipeline-types.ts`);
  threaded through `pipeline.ts`, `generateReviewTextStage` (`pipeline-stages.ts`),
  `buildPromptVariables` (`generator-helpers.ts`, patch fallback = generic changeset via
  `formatGenericPatchNotes()`), and `replaceTemplateVariables` (`prompts.ts`, added the two
  `.replaceAll`s). Added `<PLAYER HISTORY>` / `<PATCH NOTES>` blocks + style lines to
  `prompts/user/2-review-text.txt`.
- **Patch changeset (data):** new `src/data-dragon/patch-notes.ts` (`getPatchChangeset` Zod
  reader, `selectRelevantPatchChanges`, `formatPatchNotes`, `formatGenericPatchNotes`; rich
  schema with `overview` prose, `themes`, `summary`, and champion/item/system changes each
  carrying `direction`/`magnitude`/`summary`/`details`); seed asset
  `src/data-dragon/assets/patch-notes.json` (patch 26.13); exported from `src/index.ts`.
- **Patch ingest (data scripts):** new `scripts/patch-analysis.ts` (`analyzePatch` via
  `claude -p` WebFetch → validated changeset, `claude-sonnet-4-6`), replacing the removed
  `patch-highlights.ts`. `scripts/update-data-dragon.ts` now writes the changeset asset (prettier'd),
  archives raw notes to `patch-notes-archive/<patch>.html` (best-effort), and feeds
  `changeset.summary` to the "What's New" changelog. `.prettierignore` excludes the archive;
  `patch-notes-archive/.gitkeep` keeps the dir present.
- **Player history (backend):** new `src/league/review/player-history-signals.ts` (pure
  `computePlayerHistorySignals` + `formatPlayerHistory`, Zod-typed) and
  `src/league/review/player-history.ts` (DB fetch of facts / rank history / co-tracked
  teammates). `generator.ts` refactored to an options object (`GenerateMatchReviewOptions`),
  builds history + cross-referenced patch notes via `buildDynamicReviewContext`, sets
  `prompts.playerHistory` / `prompts.patchNotes`; call site in `match-report-ai-review.ts`
  updated to pass `targetGuildIds`.
- **Temporal:** added `packages/data/patch-notes-archive` to `GENERATED_PATHS` in
  `src/activities/data-dragon.ts` (the changeset asset is already covered by the existing
  `src/data-dragon` entry).
- **Tests:** `patch-notes.test.ts`, `patch-analysis.test.ts`, `player-history.test.ts` (all
  pass). Full data suite (413) + backend review suite green. typecheck/eslint clean across
  data, backend, temporal, frontend.

### Remaining

- Not committed / no PR opened (awaiting user go-ahead).
- Live acceptance: run the postmatch path (or the frontend review tool) against a tracked
  player with existing `MatchParticipantFact` rows and confirm the `<PLAYER HISTORY>` /
  `<PATCH NOTES>` blocks are populated and influence the review text; attach a before/after to
  the PR per repo PR-media convention.
- First real patch bump will regenerate `patch-notes.json` from live Riot notes; the seed is a
  hand-written placeholder for patch 26.13.

### Caveats

- `analyzePatch` uses `claude -p` with WebFetch (offline/CI tooling only); the backend never
  calls it — reviews read the committed changeset asset. A failed analysis leaves the existing
  asset untouched and falls back to the data-refresh changelog line.
- Champion matching normalizes to Data Dragon keys and strips non-alphanumerics, so human
  names ("Lee Sin") match fact-row keys ("LeeSin"). Item matching is case-insensitive exact on
  Data Dragon item names; system/role matching is keyword-based against the player's lane.
- Player-history is **fail-fast**: a player with no tracked account or no prior games yields
  an empty block (not an error), but a genuine DB/parse failure propagates and is handled by
  the review's existing outer error handler (Sentry + no review posted) rather than being
  silently swallowed. The generator unit test mocks `buildPlayerHistoryContext` since it isn't
  about the DB.
- "Today/this week" use `America/Los_Angeles`; "latest patch" is injected rather than the
  match's exact `gameVersion` (accepted simplification).
- Pre-existing environment gap: `@shepherdjerred/llm-models` must be built (`bun run build` in
  `packages/llm-models`) + `bun install` re-copied before scout `data`/`temporal` typecheck;
  `scripts/setup.ts` doesn't build it. Did this manually this session.
