# @scout-for-lol/data

Shared Scout domain models, schemas, review pipeline prompts, and the committed
League of Legends static-data snapshot. Other Scout workspaces import from this
package instead of calling Riot or CommunityDragon at runtime.

## Data Dragon assets

`src/data-dragon/assets/` is a committed snapshot of Riot's Data Dragon (plus
selected CommunityDragon data) pinned to the version in `assets/version.json`.
It is regenerated — never hand-edited — by:

```bash
bun run update-data-dragon            # full refresh to the latest version
bun run update-data-dragon 16.16.1    # full refresh to a specific version
```

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
`src/model/champion-registry.ts`, and returns closest-match suggestions for
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
