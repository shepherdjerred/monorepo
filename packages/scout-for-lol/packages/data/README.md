# @scout-for-lol/data

Shared Scout domain models, schemas, review pipeline prompts, and the committed
League of Legends static-data snapshot. Other Scout workspaces import from this
package instead of calling Riot or CommunityDragon at runtime.

Contracts that need nothing but zod live in `@scout-for-lol/domain` and are
re-exported from here. This package owns everything those contracts must not
know about: Prisma's storage domain, Discord and Riot shapes, and the static
snapshot below.

## Bryan Bucks storability

`src/model/bucks/bryan-bucks-money.ts` is the Prisma edge of the Bucks economy.
The semantic brands — what a quantity means — are defined in
`@scout-for-lol/domain/identity/bucks-money.ts` and carry no storage bound; see
that package's README. What lives here is the part domain must not know: a
Prisma `Int` column is 32 bits wide, and a value bound for one has to fit.

- `BUCKS_INT32_MAX` is that ceiling.
- `StorableBucksStakeSchema`, `StorableBucksAmountSchema`, and
  `StorableBucksDeltaSchema` add the bound on top of a semantic brand. A
  `StorableBucksAmount` **is** a `BucksAmount` — the brands intersect — so
  checking storability never forces a conversion on the way back out, and only
  code that genuinely requires a storable value has to say so.
- `storableStake`, `storableAmount`, and `storableDelta` assert an
  already-branded value against that bound at a persistence boundary. Callers
  that must not throw (user input, quote arithmetic) use the schemas'
  `safeParse` directly.

The bound is a `.check(z.lte(...))` rather than a `.refine(...)` on purpose: a
check stays visible to `z.toJSONSchema`, so generated contract schemas still
advertise the ceiling. A refine validates identically and emits nothing.

### The re-export shim

The domain schemas are re-exported from this module rather than redeclared.
Zod brands are structural: an independently defined schema carrying the same
tag typechecks identically while validating differently, so a copy would drift
silently and a value branded through one package would not be branded through
the other. Import sites must receive the _same_ schema objects.
`src/model/core/domain-reexport-identity.test.ts` asserts that object identity
and is hand-enumerated — extend it when another schema moves behind a shim.

### `BucksStorageOverflowError`

The error a value too large for its column raises. It is defined here, beside
the helpers that throw it, because the data layer is where the Int32 bound is
known.

Every recovery path keys off `instanceof`: pool settlement retries as a
matched-principal refund, dare settlement voids with a full refund, and
placement turns it into a "storage limit" reply. So
`packages/backend/src/betting/ledger.ts` **re-exports this one class object**
rather than declaring its own — a second class would typecheck fine and silently
stop matching every one of those catches.

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
