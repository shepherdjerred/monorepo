# Add Missing Branded Types to scout-for-lol

## Context

The scout-for-lol project uses Zod `.brand()` extensively for type-safe IDs (database IDs, Discord IDs, League account IDs, MatchId, ChampionId, LeaguePoints). However, several domain concepts still use plain `z.number()` where branded types would prevent ID mixups at compile time: item IDs, summoner spell IDs, rune IDs, rune tree IDs, augment IDs, and queue IDs.

## New Branded Types

| Type         | Base     | Constraint            | Defined In               | Rationale                  |
| ------------ | -------- | --------------------- | ------------------------ | -------------------------- |
| `ItemId`     | `number` | `int().nonnegative()` | `model/champion.ts`      | 0 = empty slot             |
| `SpellId`    | `number` | `int().nonnegative()` | `model/champion.ts`      | 0 = no spell in some modes |
| `RuneId`     | `number` | `int().positive()`    | `model/champion.ts`      | Always real IDs            |
| `RuneTreeId` | `number` | `int().positive()`    | `data-dragon/runes.ts`   | Tree-level concept         |
| `AugmentId`  | `number` | `int().positive()`    | `model/arena/augment.ts` | Arena augment IDs          |
| `QueueId`    | `number` | `int().nonnegative()` | `model/state.ts`         | 0 = custom game            |

## Design Decisions

- **Raw schemas stay plain** — `raw-*.schema.ts` files mirror external API structure; branding happens at the transformation boundary
- **ChampionId stays in `competition.ts`** — Moving it would be churn with no functional benefit; it's only used there
- **data-dragon static schemas get branded** — `RuneTreeSchema` parses a static JSON file, so branding `id` fields there makes all downstream lookups type-safe automatically

## Files to Modify

### Step 1: Define branded types in model files

**`packages/data/src/model/champion.ts`** — Add `ItemIdSchema`/`ItemId`, `SpellIdSchema`/`SpellId`, `RuneIdSchema`/`RuneId`. Update:

- `RuneSchema.id`: `z.number()` → `RuneIdSchema`
- `ChampionSchema.items`: `z.array(z.number())` → `z.array(ItemIdSchema)`
- `ChampionSchema.spells`: `z.array(z.number())` → `z.array(SpellIdSchema)`

**`packages/data/src/model/arena/augment.ts`** — Add `AugmentIdSchema`/`AugmentId`. Update:

- `FullAugmentSchema.id`: `z.number()` → `AugmentIdSchema`
- `MinimalAugmentSchema.id`: `z.number()` → `AugmentIdSchema`

**`packages/data/src/model/state.ts`** — Add `QueueIdSchema`/`QueueId`. Update:

- `parseQueueType(input: number)` → `parseQueueType(input: QueueId)`

### Step 2: Update data-dragon schemas and functions

**`packages/data/src/data-dragon/runes.ts`** — Add `RuneTreeIdSchema`/`RuneTreeId`. Import `RuneId` from model. Update:

- Tree-level `id: z.number()` → `RuneTreeIdSchema`
- Rune-level `id: z.number()` → `RuneIdSchema` (imported)
- `getRuneInfo(runeId: number)` → `getRuneInfo(runeId: RuneId)`
- `getRuneTreeName(treeId: number)` → `getRuneTreeName(treeId: RuneTreeId)`
- `getRuneTreeInfo(treeId: number)` → `getRuneTreeInfo(treeId: RuneTreeId)`
- `getRuneTreeForRune(runeId: number)` → `getRuneTreeForRune(runeId: RuneId)`, return `treeId: RuneTreeId`

**`packages/data/src/data-dragon/images.ts`** — Update:

- `validateItemImage(itemId: number)` → `validateItemImage(itemId: ItemId)`
- `getItemImageUrl(itemId: number)` → `getItemImageUrl(itemId: ItemId)`
- `getItemImageBase64(itemId: number)` → `getItemImageBase64(itemId: ItemId)`

**`packages/data/src/data-dragon/item.ts`** — Update:

- `getItemInfo(itemId: number)` → `getItemInfo(itemId: ItemId)`

**`packages/data/src/data-dragon/arena-augments.ts`** — Update:

- `getCachedArenaAugmentById(id: number)` → `getCachedArenaAugmentById(id: AugmentId)`

### Step 3: Update transformation boundary (match-helpers.ts)

**`packages/data/src/model/match-helpers.ts`** — This is where raw numbers become branded:

- Import `ItemIdSchema`, `SpellIdSchema`, `RuneIdSchema`
- `extractRunesFromStyle`: wrap `selection.perk` with `RuneIdSchema.parse()` and pass to `getRuneInfo`
- `participantToChampion`: wrap `participant.item0`–`item6` with `ItemIdSchema.parse()`, wrap `summoner1Id`/`summoner2Id` with `SpellIdSchema.parse()`

### Step 4: Update downstream callers

**`parseQueueType` callers** (13 call sites across backend/frontend/report) — wrap `rawMatch.info.queueId` / `gameInfo.gameQueueConfigId` with `QueueIdSchema.parse()`:

- `packages/backend/src/league/model/match.ts:40`
- `packages/backend/src/league/competition/processors/helpers.ts:28`
- `packages/backend/src/league/review/test-reviews.ts:145,233`
- `packages/backend/src/league/tasks/postmatch/match-report-generator.ts:182,375,380`
- `packages/backend/src/league/tasks/prematch/prematch-notification.ts:43`
- `packages/backend/src/league/tasks/pairing/calculate-pairings.ts:246`
- `packages/frontend/src/lib/review-tool/match-converter.ts:101,212`
- `packages/report/src/match.ts:42`

**`mapAugmentIdsToUnion` in `packages/backend/src/league/arena/augment.ts`** — Update `augmentIds: number[]` → `augmentIds: AugmentId[]`, and `extractAugments` in `packages/backend/src/league/model/champion.ts` to parse raw augment IDs with `AugmentIdSchema.parse()`

### Step 5: Update exports

**`packages/data/src/model/index.ts`** — Export new types: `ItemId`, `ItemIdSchema`, `SpellId`, `SpellIdSchema`, `RuneId`, `RuneIdSchema`, `QueueId`, `QueueIdSchema`, `AugmentId`, `AugmentIdSchema`

### Step 6: Fix tests

Any test constructing `Champion`, `Rune`, `Augment` objects with literal numbers, or calling `parseQueueType` with literal numbers, needs to use the appropriate schema `.parse()`.

## Verification

After each step:

1. `cd packages/scout-for-lol && bun run typecheck` — catch cascading type errors
2. `cd packages/scout-for-lol && bun run test` — ensure no runtime failures
3. `cd packages/scout-for-lol/packages/data && bunx eslint . --fix` — lint clean
