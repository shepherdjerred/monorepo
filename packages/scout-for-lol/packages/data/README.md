# @scout-for-lol/data

Shared Scout domain models, schemas, and the committed
League of Legends static-data snapshot. Other Scout workspaces import from this
package instead of calling Riot or CommunityDragon at runtime.

Contracts that need nothing but zod live in `@scout-for-lol/domain` and are
re-exported from here. This package owns everything those contracts must not
know about: Prisma's storage domain, Discord and Riot shapes, and the static
snapshot below.

Data Dragon URL getters can run in browsers. Cached-image validation and base64
helpers require Bun and load Node's file-URL conversion when reading local
assets, so importing the shared module does not initialize server-only code.

## Raw Riot captures and ability icons

Raw match, spectator and timeline schemas validate known fields while retaining
the complete captured JSON, including future fields, nested arrays, nulls and
absent optional values. Application protocol schemas remain strict. The lake
stores complete analytical documents alongside its typed projections; spectator
credentials remain excluded from analytical data.

The static-data update downloads passive and Q/W/E/R ability icons from the
same Data Dragon version as the champion facts. The generated asset manifest
includes the `ability` kind and uses `Champion-slot` identities, such as
`Ahri-Q`. Regenerate the manifest after changing committed assets.

## Game facts for tooltips

`src/game-facts/` holds the schema (`schema.ts`, a `GameFact` union by kind:
champion, ability, item, rune, summoner spell, keyword), the pure builders
(`build.ts`) and a typed client (`loadGameFact(kind, key, { signal })`). Facts
are generated from the committed Data Dragon snapshot into
`assets/facts/<kind>/<key>.json`, one small file per entity, and the shared
asset emission serves them at `/assets/scout/game/<patch>/facts/<kind>/<key>.json`.
Keys are the Data Dragon champion key, `<champion>-<slot>` for abilities, and
the numeric Riot id for items, runes and summoner spells.

Item summaries come from the item's stats and passive text; Data Dragon's
`plaintext` is never read because it is unreliable. Regenerate after changing
the snapshot (the full refresh does this for you):

```bash
bun run generate:game-facts   # rewrite assets/facts/
bun run check:game-facts      # fail on drift (also part of `generate`)
```

## Dare contracts

`src/model/dares/` defines free SQL challenges, targets, deadlines, progress,
and consent actions. Contracts contain no currency or financial quantities.

## Data Dragon assets

`src/data-dragon/assets/` is a committed snapshot of Riot's Data Dragon (plus
selected CommunityDragon data) pinned to the version in `assets/version.json`.
It is regenerated — never hand-edited — by:

```bash
bun run update-data-dragon            # full refresh to the latest version
bun run update-data-dragon 16.16.1    # full refresh to a specific version
```

Arena augment generation also preserves IDs 71 and 250 from CommunityDragon
15.23, which appear in recorded matches but are absent from the current
catalog. `--arena-augments-only` regenerates that cache against the committed
version without refreshing unrelated assets.

Match history uses `getCachedAugmentNameById` and the separate generated
`assets/augment-names.json` catalog. The client's English `cherry-augments.json`
contains recorded IDs from Arena, ARAM Mayhem, and Classic that are absent from
the detailed Arena endpoint. Generation merges the retained CommunityDragon
16.19 client snapshot with the current pinned patch, preserving removed IDs;
current names win only when the augment's internal identity is unchanged.
Duplicate IDs, conflicting identities, malformed names, and unknown runtime
IDs fail loudly. Name-only entries do not fabricate report metadata or icons;
`getCachedArenaAugmentById` continues to return only detailed Arena assets.
Both the full refresh and `--arena-augments-only` rebuild the name catalog.
To regenerate only recorded names at the committed version:

```bash
bun run update-data-dragon --augment-names-only
```

Classic loading-screen backgrounds retain the 2 MiB asset budget. If the
upstream PNG exceeds it, the updater recompresses it losslessly, preserving
dimensions, pixels and metadata. It still fails if the compressed asset exceeds
the budget; it does not reduce resolution or relax the size check.

The refresh runs weekly via the `scout-data-dragon-weekly-refresh` Temporal
schedule. Typed readers live beside the assets in `src/data-dragon/`
(`champion.ts`, `item.ts`, `ability-facts.ts`, ...); all of them validate with
Zod at read time.

### Ability facts (`assets/ability-facts/`)

One file per champion (`{ChampionKey}.json`, e.g. `Chogath.json`) with grounded
per-ability numbers for the voice assistant and other fact-answering features:

- **Per slot** (`passive`/`Q`/`W`/`E`/`R`): ability name, `maxRank`,
  `cooldownByRank`, `costByRank`, `costType`, `rangeByRank` (from Data Dragon),
  plus `dataValues` and a `resolvedDescription` (from the champion's
  CommunityDragon `.bin.json`, the only public source for ability damage
  numbers — Data Dragon tooltips leave them as `{{ template }}` placeholders).
- **Rank indexing is 1-based relative to the arrays**: index `[0]` of
  `cooldownByRank`, `costByRank`, `rangeByRank`, and every `dataValues` entry
  is the rank 1 value (e.g. Cho'Gath `RBaseDamage: [300, 475, 650]` → rank 1
  Feast deals 300).
- **`resolvedDescription`** is the Data Dragon tooltip with markup stripped and
  placeholders substituted only where they resolve mechanically from bin
  DataValues and spell calculations. The generator never guesses: any token it
  cannot resolve stays literal `{{ token }}` text and is listed in that
  ability's `unresolved` array, so consumers can decline honestly instead of
  inventing numbers.
- **`mechanics`** (optional) is how the ability is aimed and how its missiles
  travel, read from the same bin and never inferred: `targeting`, `castTime`,
  `radius`, `lineWidth`, `missileSpeed`, and a `missiles` list with each
  missile's width, movement, speed, behaviors and `stopsOnFirstHit` (the bin's
  `DestroyOnHit`). It is what separates "passes through minions" from "stops at
  the first enemy". The slot omits it when the bin states nothing.

Read them through `getAbilityFacts(championName)` in
`src/data-dragon/ability-facts.ts`. The input is a user boundary: it accepts
any casing/punctuation and the spoken aliases in
`src/model/riot/champion-registry.ts`, and returns closest-match suggestions for
unknown names instead of throwing.

Regenerate just these assets (pinned to the committed `version.json`, requires
network access to `raw.communitydragon.org`):

```bash
bun run scripts/update-data-dragon.ts --ability-facts-only
```

The generator exits non-zero if any champion's bin fails to fetch or parse and
prints a coverage summary (champions processed, abilities fully resolved,
abilities with unresolved tokens). The full refresh regenerates these files as
part of every run.

## Generated tips (`src/tips/`)

Tips are short advice written ahead of time by a model, never by users:
matchup tips for each ordered (champion, opponent, lane), three to six general
tips per (champion, lane), and keyword glossary entries for tooltips. Every tip
cites the facts it leans on; ability cites drive the icons beside a tip.

- `schema.ts` defines the sets and the files under `src/tips/generated/`:
  `matchup/<lane>/<ChampionKey>.json` (every opponent of one champion in one
  lane), `general/<lane>.json` and `glossary.json`.
- `plan.ts` prunes the matrix. A (champion, lane) is viable when the lane holds
  at least 10% of the champion's games and the champion is at least 0.5% of the
  lane's picks; each keeps opponents, most played first, until they cover 60%
  of its lane games, at most 15. One unordered pair is one generation unit that
  writes both directions. `plan-sources.ts` reads the counts from lane priors
  (opponents estimated from lane shares) or from meta serving slices.
- `validate.ts` checks a tip against the committed ability facts and Data
  Dragon: every ability name belongs to the unit's champions and is cited,
  every number is a cited ability value or a level, a percentage is allowed
  only when it matches a cited ability value ("slows by 65%"), no statistics
  such as win rates or game counts, at most two sentences, no explanatory lead-ins, and no near-duplicates across the two
  directions of a pair or against the general tips.
- `input-hash.ts` hashes the prompt version with a stable projection of the
  unit's grounding (ability facts, tags, Riot's ally and enemy tips). A set
  whose hash no longer matches the current facts is stale.
- A generated matchup side has 3 to 20 tips and a general set 3 to 15
  (`MATCHUP_TIPS_*`, `GENERAL_TIPS_*` in `schema.ts`): as many distinct, true,
  non-overlapping tips as the facts support, never padded to a number. The
  validators enforce the bounds on a draft; the stored-file schema accepts a
  matchup side of one tip so the first pilot's sets stay valid.
- `getChampionLaneTips` and `getMatchupTips` (`load.ts`) return a set's tips
  and the patch they agree with, or null when the pruned matrix has no set, the
  set is stale, or a filter thinned it below the minimum above. A hidden set is
  never a build failure; a file that fails its schema throws.

### Generating tips

`scripts/generate-tips.ts` writes `src/tips/generated/`. One model call per
unordered pair writes both directions; `prompt.ts` holds the versioned prompt
(`TIP_PROMPT_VERSION`, part of every input hash), `check-draft.ts` and
`generate-unit.ts` validate each answer and retry a failed unit once with the
validator's findings fed back. A unit that still fails is dropped and reported,
never written; a failed model call (credentials, transport) fails the run.

- `--plan` prints the units, what each would do (generate, re-stamp, current)
  and an estimated cost, and spends nothing.
- `--max-cost-usd` is required for a real run and is a hard stop: every call
  reserves its worst case first, and the run stops, writing what it finished,
  when the next call could pass the limit.
- `--only lane/Champion[,Opponent]` (repeatable), `--lane`, `--limit` (the
  most-played pairs) and `--kind matchup|general` narrow a run. `--model`
  defaults to `claude-haiku-5-5`; `--promptVersion` stamps a different version.
- A set that is current is skipped. A set whose facts changed but whose text
  still validates is re-stamped without a model call. Answers are cached by
  request hash in the git-ignored `.tips-cache/`, so a rerun after a crash, a
  validator change or a dropped unit never pays twice for a request already
  answered (`--no-cache` asks again).

Glitter's context refresh has the same two cost controls (a request-hash cache
and a budget), but they live in the Temporal worker against its object store
and throw Temporal failures, so the generator carries local versions in
`model.ts`.

The League of Legends Wiki grounds what Data Dragon leaves out (how a
projectile treats minions, what a status does). `wiki.ts` reads it through the
MediaWiki API of `wiki.leagueoflegends.com` only (every URL is checked against
that host), one request at a time with a pause between them and a descriptive
User-Agent. Each unit prefetches both champions' ability notes into the prompt,
and the model has a `lookup` tool for any other page (an item, a status, a
mechanic). Pages are cached on disk by page and revision in the git-ignored
`.tips-cache/wiki/`. A set records the revision of every page it used in its
`wiki` field and in its `inputHash`; a champion's page is recorded with its
patch-history page, because ability data lives in templates and a patch edits
the history. The generator re-reads those revisions: an edited page regenerates
only the sets that used it, while the offline reader still calls a set stale
only when Data Dragon's facts changed. `--no-wiki` runs on the grounding alone.

Two more committed sources join the grounding (`groundingVersion` 2 on a set,
absent meaning the earlier ability facts, tags and Riot tips only):

- CommunityDragon mechanics. `scripts/ability-mechanics.ts` reads, from the
  champion bins `ability-facts` already fetches, each ability's aiming data
  (targeting type, cast time, radius, line width, missile speed) and the
  missile spells under the same ability object (width, speed, movement type,
  behaviors). A missile with a `DestroyOnHit` behavior ends at the first unit it
  hits; one without it keeps going. They land in each ability's `mechanics`
  field of `assets/ability-facts/{Key}.json` when `update-data-dragon
--ability-facts-only` runs. The `mAffectsTypeFlags` bitmasks are not decoded.
- Recent patch changes. The `patch-changes` parser's output
  (`assets/patch-changes.generated.json`, see the patch-notes archive) gives
  each champion's lines from the newest three patches, so a tip never describes
  a value a patch has changed. `patch-context.ts` selects them.

Both are in the prompt and the input hash of a version 2 set, so a refreshed
bin or a new patch regenerates exactly the sets whose champions changed. Every
generated tip names the sources it rests on (`basis`); the eval reports how
often the generator and the judges name each one.

Credentials come from the environment through `@shepherdjerred/llm-runtime`
(`ANTHROPIC_API_KEY` or the federation variables, `OPENAI_API_KEY` for the
OpenAI judge). Locally, through the 1Password-backed wrapper and an env file of
`op://` references:

```bash
scripts/onepassword/with-service-account.sh \
  op run --env-file=<env file> -- \
  env -u OP_SERVICE_ACCOUNT_TOKEN \
  bun packages/scout-for-lol/packages/data/scripts/generate-tips.ts \
  --max-cost-usd 5 --lane middle --limit 20 --kind matchup
```

The Anthropic reference is
`packages/dotfiles/private_dot_config/private_fish/anthropic.env.example`; the
OpenAI reference is the `OPENAI_API_KEY` line of
`packages/scout-for-lol/dev-web.env.tpl`. A scheduled run in Temporal needs its
own Anthropic credentials on the Scout worker; without them the model call
throws and the run fails visibly.

`scripts/tips-eval/eval-tips.ts` runs the fixed cases in `src/tips/eval/cases.json`
(30 pairs, 10 single champions) through the same generator without writing
tips. Two judge models from different families (`claude-opus-5-5` and
`gpt-6.1-terra`, the model Explore's own judge uses) then read the same
grounding, with the wiki notes and the same `lookup` tool, and score each tip of
every accepted unit: factually correct, wrong or not checkable, useful, and
plain, with a one-line reason; a judge must look things up before marking a tip
wrong or not checkable. It writes one report per generator model and run,
`.tips-eval/eval-report.<model>.run<N>.json` (pass rates, drops,
each judge's rates, the judges' agreement, tool calls, wiki pages, cost, and the
full text and verdicts of every tip). `--run` mixes the run number into every
request key so a second run asks the models again. `--summary` rebuilds
`src/tips/eval/eval-summary.md`: the model comparison with each run's spread and
the projected cost of a full run and of a patch. The `--max-cost-usd` budget
covers the generator and both judges together.

### Raw eval output

The eval and pipeline scripts write their raw JSON (per-run reports, judge
verdicts, samples, the full-run report) to `.tips-eval/`, which is ignored by
version control, and only small summaries are committed under
`src/tips/eval/` (`eval-summary.md`, `eval-filter.md`, `eval-decisions.md`,
`thick-sample.md`, `cost-options.md`, `triage-calibration.md`,
`marks-agreement.md`). The raw files a summary rests on are attached to the pull
request that produced it. To rebuild a summary, put those files back in
`.tips-eval/`; a missing file fails the script rather than being skipped.

### Batches, caching and the Sonnet filter

Generation and judging are offline, so they can run on Anthropic's Message
Batches API at half price. `@shepherdjerred/llm-runtime/batch` (`createAnthropicBatchClient`)
submits a batch, polls it and returns typed outcomes priced at the batch tier,
cache reads and writes included; the batch API has no tool loop, so
`scripts/tips-batch.ts` answers each `lookup` call locally and resubmits the
unfinished requests as the next round (the last round forbids tools). Every
round reserves its worst case against `--max-cost-usd` before it is submitted.
The interactive path (`generateValidatedObject`) takes one prompt string, so it
cannot place a cache breakpoint; the batch client can.

A prompt is built in two parts (`TipPrompt.prefix` and `rest`): the glossary and
one champion's block come first and end at a cache breakpoint, so every unit that
leads with that champion pays for the block once. Units are ordered by that
champion. `scripts/tips-eval/batch-sample.ts` measures the real saving on one small batch
(the ten most-played Akali matchups generated and judged) and writes
`.tips-eval/batch-sample.json`.

`scripts/tips-eval/rejudge-tips.ts` re-judges the tips the eval already generated with
Sonnet (medium and low reasoning effort) as batches, without regenerating, into
`.tips-eval/sonnet-judge.json`. `scripts/tips-eval/eval-filter.ts` compares
those verdicts with the two reference judges (recall on tips both call wrong,
false drops on tips both call correct, Sonnet's own rates) and projects the cost
of a full run and of a patch for each generator with the Sonnet filter, into
`src/tips/eval/eval-filter.md`.

### The Decisions API judge and the thick sample

OpenAI's Decisions API (`POST /v1/decisions`, `gpt-6-luna` only) answers several
bounded questions about one input and returns a probability for each answer, with
free output tokens and no tool use. `scripts/decisions/client.ts` sends a unit's
grounding and wiki notes and asks, per tip, correct / wrong / not checkable and
useful. The API has no `system` parameter and takes a cache breakpoint as an
object, neither of which `runtime.decide` sends, so the instructions go in a
developer message and the cache is the implicit one.
`scripts/decisions/rejudge.ts` re-judges the eval's tips into
`.tips-eval/decisions-judge.json`; `scripts/decisions/judge-report.ts`
measures it against the two reference judges next to the Sonnet variants, into
`src/tips/eval/eval-decisions.md`.

`scripts/sample/pipeline.ts` is the shared offline pipeline: generate a list of
units as one batch, validate each answer, resubmit the ones that failed once
with the findings (as the interactive path does), and judge every accepted unit
with Sonnet (medium, batch) and the Decisions API without dropping any tip. A
keyword cite whose word the tip's text lacks is dropped by the validator instead
of failing the unit; the tip does not depend on it.

`scripts/tips-eval/thick-sample.ts` runs it for a 20-unit sample (popular and niche
matchups and general sets in Mid) with the thick counts and writes
`.tips-eval/thick-sample.<generator>.json` without touching
`src/tips/generated/`. `scripts/tips-eval/thick-report.ts` turns those into
`src/tips/eval/thick-sample.md`: tips per set before and after filtering, sets
below the minimum, projected cost of a full run and of a patch per generator and
judge, and four example sets per generator.

`scripts/sample/review-set.ts` builds a review set for a person to read: the
general sets and the top matchups of the champions they play, written by Sonnet
and Opus on the same units, every tip carrying both judges' verdicts, as one JSON
array outside the repository (default
`~/.local/share/scout-redesign/tips-review/review-set.json`).

### The multi-pass pipeline

`scripts/pipeline/run.ts` is the generator for a first full run: it does not ask
one model for one answer. Every step is a batch with the shared prefix cached,
Sonnet is the default model (`--generator`), and the Decisions API triages.

1. Generate: tips-4 with the one retry. It can start from an earlier review set
   (`--review-set`), so tip ids, and marks on them, carry over.
2. Fill: the model sees the set's tips so far and writes more that are distinct
   and true; repeat until a pass adds fewer than 2 tips to a side or the side is
   full (20 per matchup side, 15 per general set), at most 3 passes.
   Near-duplicates are rejected with the validators' own word-overlap measure
   (`tipSimilarity`, threshold 0.6), a free deterministic check; a tip sharing
   eight consecutive words with the wiki notes is rejected as a copy
   (`copy-check.ts`).
3. Triage: the Decisions API judges every tip. Below `lo` with no interaction
   claim, it is kept; at `hi` or above it goes to repair; otherwise, or when the
   tip asserts an interaction (blocks, interrupts, reveals, collides, cancels,
   stops), it is escalated. `pipeline/calibrate.ts` prints the table the
   thresholds (`triage.ts`) were chosen from, against the cached
   two-reference labels, and reads Jerred's marks (`marks.json`) when they
   exist.
4. Escalate: Sonnet medium re-judges the uncertain tips and must call `lookup`
   before answering about a claim the notes do not state; a second pass gives
   the still unchecked tips the web search tool.
5. Repair: a tip judged wrong is rewritten once from the judge's reason and the
   grounding (lookup and search available), re-triaged, and dropped if it is
   still wrong or uncertain. A set left under 3 tips is hidden by the reader.
6. Combos, tricks, rotations and terrain spots (`combo-schema.ts`,
   `combos.ts`): 0 to 8 per champion-lane general set, only well-known ones;
   every one is escalated, and a matchup side may reference up to 3 with a
   note.

Web search is Anthropic's server-side tool (`web_search_20260209`, also accepted
by the Message Batches API), capped per tip (`--searches-per-tip`, 2) and per
run (`--max-searches`), with its cost in `--max-cost-usd`. Nothing a search
returns is stored: a tip's history keeps only the URLs, and the in-memory
result text feeds the copying check. `pipeline/search-experiment.ts` measures
what search adds.

Combos are optional and not forced: the prompt makes an empty list the default
and asks only for well-known, champion-specific combos and tricks. The validator
rejects a generic damage order: a `combo` or `rotation` whose abilities are in
slot order with no named trick, or that is described as a "full trade" or an
"all-in" (`isGenericSequence`, `isGenericWording`).
`pipeline/combos-survival.ts` shows what that validator keeps of the cached
combos.

`pipeline/marks-report.ts` reports each judge's and pass's agreement with
Jerred's marks (`marks.json`, an export of the review artifact's `marks`
collection), and `pipeline/cost-options.ts` estimates full-run and per-patch cost
against shipped quality for configurations of the pipeline without running
anything; it reads the last run's report from `.tips-eval/pipeline-run.json`
(the `.report.json` that `pipeline/run.ts` writes beside its output) and writes
`src/tips/eval/cost-options.md`.

### The generated champion tips

`scripts/pipeline/full-run.ts` is the first full run: pass 1 with Sonnet over the
plan's whole unit list, most-played first, then combos for the general sets and
Decisions triage of every tip. It does not escalate or repair; a tip is hidden
(`hidden: true`, kept in the file) only when its p(wrong) is 0.85 or more and it
asserts an interaction. Every chunk of units is checkpointed to
`.tips-cache/full-run/` before the next starts, the whole run is held to
`--max-cost-usd` (batches and Decisions together), and it stops and reports
rather than trim quality if the projected spend will not fit.

The output is one JSON file per champion, `src/tips/generated/champions/<Key>.json`
(its general sets with their combos, and its matchup sets), plus
`src/tips/generated/index.json` (`champion-tips.ts`). Generated, never edited by
hand; `champion-generated.test.ts` holds the files to the schema, the references
to the game facts and the size to a budget (512 KiB a file, 24 MiB in all).
`committedChampionTips` / `createChampionTipsReader` (`champion-reader.ts`) read
one champion at a time and hide a hidden tip, and a set left under the minimum.

Every entity a tip or combo mentions is a reference in the game-fact key format
(`src/game-facts/`) with the character span it covers, so a page can make that
phrase the tooltip trigger: `{kind: "ability", key: "Ahri-E", start, end}`, an
item or summoner spell by its numeric id, a champion by its Data Dragon key, a
keyword by its glossary slug. Combo steps use the same keys. A unit whose
reference resolves to no game fact fails whole (`refs.ts`, `champion-output.ts`).
The glossary is emitted as keyword game facts
(`src/data-dragon/assets/facts/keyword/<id>.json`, `bun run generate:game-facts`).

The earlier per-lane layout (`generated/matchup`, `generated/general`) is the
interactive generator's (`generate-tips.ts`) and holds only its pilot.

## Patch changes

`patch-notes-archive/{patch}.html` holds the raw official patch-notes page for
each patch, archived by the refresh before any model call. Patches missing from
it are fetched, with no model, by `bun run backfill-patch-notes`.

`src/data-dragon/assets/patch-changes.generated.json` is derived from that
archive by `src/data-dragon/patch-changes-parser.ts` (a streaming `HTMLRewriter`
pass over the champions and items sections): one entry per `before ⇒ after`
line, with the subject mapped to its champion or item id, the ability heading it
sits under, and a `buff`/`nerf`/`adjust` direction. A line is buff or nerf only
when before and after have the same shape and every number moved the same way
(lower is stronger for cooldown, cost and cast time); anything else is adjust.
A subject's direction for a patch is buff or nerf only when all its lines agree
(`overallDirection`). Lines that are not before/after changes are skipped, not
guessed at. Names the registries cannot place fail generation. Regenerate with
`bun run generate:patch-changes`; `bun run generate` fails if the file is stale.
Read it through `getPatchChanges(kind, id)` in `src/data-dragon/patch-changes.ts`.
