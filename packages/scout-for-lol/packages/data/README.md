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
- `getChampionLaneTips` and `getMatchupTips` (`load.ts`) return a set's tips
  and the patch they agree with, or null when the pruned matrix has no set or
  the set is stale. A stale set is hidden, never a build failure; a file that
  fails its schema throws.
