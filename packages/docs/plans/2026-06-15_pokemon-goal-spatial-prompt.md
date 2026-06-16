# Pokemon goal-mode: spatial state + rich prompt rewrite

## Status

Complete (waiting on review/merge of PR #1261)

## Context

The Codex goal-mode AI driving `discord-plays-pokemon` is spatially blind and lore-blind. Observed failures from running goals (live screenshot the user attached as evidence):

- **Stair confusion case (from user screenshot):** player stood inside a building, one tile to the right of a down-staircase. AI believed it was directly under the stair, and even after re-positioning correctly, didn't know that in Gen-3 Pokémon you walk _up_ onto the down-stair tile from below to descend (and walk _down_ onto an up-stair tile from above to ascend). The interaction is counter-intuitive and isn't covered by any prior tutorial.
- **Spins in place:** first press of a new direction TURNS without moving; AI taps once, sees no change, assumes the press did nothing.
- **Misses interactions:** stands diagonally or one tile too far from a sign/NPC, presses A, nothing happens.
- **Lore-blind:** doesn't know what "Devon Goods", "the SS Tidal", "Steven's letter", "Trick House" or "Berry Master" mean when those come up in dialog, so it can't form sensible goals around them.
- **Can't parse screenshots reliably:** doesn't distinguish tall grass from path texture, doesn't recognize a closed dialog box from an open one, doesn't read which way the player sprite is facing.

Today the prompt at `packages/discord-plays-pokemon/packages/backend/src/goal/codex-command.ts:65-108` (`buildPrompt`) only covers buttons, gyms, and a route-101 narrative. The state summary at `packages/discord-plays-pokemon/packages/backend/src/goal/game-state-summary.ts:12-25` only emits party / badges / Pokédex count / last-catch — nothing spatial. The model just bumped to `gpt-5.4-mini` (5× nano), so a longer prompt + richer state is affordable.

**Goal:** ship two complementary changes together:

1. **Expose spatial + map state from `pokeemerald.wasm` into `pokemonctl state`** so the AI _knows_ where it is, which way it's facing, what's on the tile in front of it, and which NPCs / signs / warps are nearby — rather than guessing from pixels.
2. **Rewrite the prompt** as a thorough Pokémon Emerald primer covering controls, movement physics, screenshot anatomy, combat, interaction recipes, the Hoenn story skeleton, major sidequests/features, and a "counter-intuitive things" catalog (stairs, ledges, surf, cut trees, dialog Yes/No mashing).

## Scope decision (from user)

User picked "Prompt + facing only" in the menu, then expanded in the next message: also expose position, map name, nearby NPCs, plus prompt should cover controls, movement, combat, lore/skeleton, features, quests/sidequests. This plan reflects the expanded scope — effectively the original "full data exposure" option plus a richer prompt body than originally drafted.

## Part 1 — Data exposure from wasm

### What we add to the snapshot

| Field                 | Source in pokeemerald                                                                                                                                      | Read as                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `playerX`, `playerY`  | `gSaveBlock1Ptr->pos.{x,y}` (in-game tile coords)                                                                                                          | u16 each                                            |
| `playerFacing`        | `gObjectEvents[gPlayerAvatar.objectEventId].facingDirection`                                                                                               | u8, map to `down`/`up`/`left`/`right`               |
| `playerRunning`       | `gPlayerAvatar.flags` bit                                                                                                                                  | u8 + mask                                           |
| `mapGroup`, `mapNum`  | `gSaveBlock1Ptr->location.{mapGroup,mapNum}`                                                                                                               | u8 each                                             |
| `mapName`             | derive from `mapGroup,mapNum` via a static lookup table                                                                                                    | TS table generated from pokeemerald's `MapSec` enum |
| `tileInFrontBehavior` | one-tile lookup in current map's metatile-behavior array at `(playerX+dx, playerY+dy)` based on facing                                                     | u8 → enum name                                      |
| `nearbyObjects`       | iterate `gObjectEvents` (max 16), filter to those on current map within 5-tile manhattan distance, emit `{kind: NPC \|SIGN \|ITEM \|WARP, dx, dy, facing}` | struct walk                                         |

`tileInFrontBehavior` is the highest-value field for the stair case: when the AI is below a stair tile, state would print `Tile ahead (up): STAIRS_DOWN — walk into it to descend to the lower floor`. That single line eliminates the entire "press up to go down" confusion.

If iterating the full map's metatile array proves too expensive or the offsets are fragile, fall back to just the 4 cardinal-adjacent tiles' behavior bytes (still solves the stair / sign / ledge cases).

### Symbols to add to `symbols.ts`

Append to `GAME_SYMBOL_NAMES` (`packages/discord-plays-pokemon/packages/backend/src/emulator/symbols.ts:6-12`):

- `gPlayerAvatar` — struct holding `flags`, `runningState`, `objectEventId`. ✅ exported.
- `gObjectEvents` — array of `ObjectEvent` (max 16 entries, OBJECT_EVENTS_COUNT in pokeemerald). ✅ exported.

**Removed during implementation:** `gMapHeader` is NOT exported by the current `tripplyons/pokeemerald-wasm` build (confirmed by enumerating the 14 wasm exports: only `gSaveBlock1Ptr`, `gSaveBlock2Ptr`, `gPlayerParty`, `gPlayerPartyCount`, `gBattleResults`, `gObjectEvents`, `gPlayerAvatar`, `gSoundInfo`, `gWasmPcm{L,R}` globals plus `VarGet`, `AgbMain`, `WasmRunFrame`, `memory`). Without `gMapHeader` we cannot do arbitrary tile-ahead metatile lookup. **Replacement that still works:** `ObjectEvent.currentMetatileBehavior` (offset 0x1E) — the metatile behavior byte of whatever tile the player is _currently_ standing on. We surface that as `OnTile:` in state, and it picks up the case where the player is already standing on a south-arrow-warp / north-arrow-warp / animated-door / ledge — i.e. it gives the AI a hint when the stair entry tile is _under_ them. It does NOT solve the "is there a stair one tile north" lookahead — that becomes a prompt-side primer responsibility (gotcha section #7), with a follow-up to add `gMapHeader` upstream tracked as a TODO.

The resolve loop in `symbols.ts:33-48` already throws on missing exports — so a build that drops one fails fast at startup, which is what we want.

### Struct offsets

Hard-code offsets as named constants in a new `packages/discord-plays-pokemon/packages/backend/src/emulator/struct-offsets.ts`, each commented with the pokeemerald source file + struct field they correspond to. Pin a specific upstream commit so a rebuild against a different fork breaks loudly. Existing pattern: `packages/discord-plays-pokemon/packages/backend/src/emulator/snapshot.ts` reads party-mon offsets in the same hard-coded style.

Offsets needed:

- `ObjectEvent.facingDirection` (~u8)
- `ObjectEvent.currentCoords.{x, y}` (s16 each)
- `ObjectEvent.graphicsId` (u16) — helps classify (NPC vs sign vs item)
- `ObjectEvent.active` flag — skip inactive slots
- `PlayerAvatar.objectEventId` (u8)
- `PlayerAvatar.flags` (u8)
- `SaveBlock1.pos.{x, y}` (s16 each)
- `SaveBlock1.location.{mapGroup, mapNum}` (u8 each)

### Map-name table

A generated TS module mapping `(mapGroup, mapNum)` → human name (`"Littleroot Town"`, `"Petalburg Gym"`, …). Generation: one-shot script at `packages/discord-plays-pokemon/packages/backend/scripts/gen-map-names.ts` that parses pokeemerald's `data/maps/map_groups.json` (or equivalent) into a TS literal. Commit the generated output; don't run gen at build time. Drop the script if there's already a more compact way (e.g. read `gMapHeader->regionMapSectionId` and look up `gRegionMapSections`); decide during implementation.

### Snapshot + state-summary changes

- `packages/discord-plays-pokemon/packages/backend/src/goal/types.ts` — extend `GameSnapshot` with `position`, `facing`, `mapName`, `tileAhead`, `nearbyObjects`.
- `packages/discord-plays-pokemon/packages/backend/src/goal/snapshot.ts` — populate new fields from the new symbols/offsets via existing `MemoryReader`.
- `packages/discord-plays-pokemon/packages/backend/src/goal/game-state-summary.ts` — append new lines after the existing party/badges/dex/catches lines:

  ```
  Position: Littleroot Town (12, 8), facing up
  Tile ahead (up): STAIRS_DOWN — walk into it to descend
  Nearby:
    - NPC 2 tiles east, facing west (likely watching path)
    - SIGN 1 tile north
    - WARP (door) 3 tiles north
  ```

- `packages/discord-plays-pokemon/packages/backend/src/goal/game-state-summary.test.ts` — keep existing `.toBe` baseline and `.toContain` field tests; add cases for facing rendering, map name interpolation, tile-ahead enum mapping, nearby-object list (empty / populated / sorted by distance).

## Part 2 — Prompt rewrite

New `buildPrompt` body, ~5000–6000 chars (current is ~1500). Structured for skimming. Keep `buildPrompt` signature unchanged, keep untrusted-input guards and `--- BEGIN/END USER GOAL ---` framing.

Sections in order:

1. **What this game is** — 2D top-down RPG, Hoenn region, you're a child trainer in Littleroot, the goal of the main story is to beat eight Gym Leaders, defeat the Elite Four, and stop the criminal Team (Magma & Aqua) from awakening Groudon / Kyogre. Save anywhere via START → SAVE.

2. **Tile grid + screenshot anatomy.** 240×160 GBA resolution, 16×16 px tiles, player at screen center, ~15×10 tiles visible. Bottom is the dialog box when open. Right column is the menu when START pressed.

3. **Identifying the player on screen.** White-haired protagonist in green/red. Facing direction inferable from sprite pose (down = facing camera; up = back of head; left/right = profile). _Note: `pokemonctl state` now prints facing explicitly — trust it over pixel inspection._

4. **Movement — the THREE critical rules.**
   - **First press of a NEW direction = turn only, no tile move.** Subsequent presses in the same direction walk one tile each.
   - **Pressing into an obstacle = turn but don't move.** Indistinguishable from a successful turn in a single screenshot; check `Tile ahead (…)` in state.
   - **Holding (`_d`) skips the turn-only first frame** — use for known-clear straight runs; use single `press` when adjacent to NPCs/objects.

5. **Reading what's on screen.** Tile taxonomy: path / tall grass (battles) / trees / water (needs HM Surf) / ledges (one-way jumps down) / sand / cave. Object taxonomy: NPCs (often colorful, may patrol, may have `!` battle bubble) / signs (small wooden tiles) / Poké Balls (interactable items) / doors (dark rectangles, auto-trigger on step) / warp tiles (often visually subtle).

6. **Interaction recipe (face → adjacent → A).** Walk to the tile directly cardinal-adjacent to the target → press the direction pointing at it (so player faces it) → press A. Diagonals don't count. Works for signs, NPCs, item balls, locked doors with key items, the PC.

7. **🪜 Counter-intuitive gotcha catalog** — the specific failure modes the user has hit:
   - **Stairs (the screenshot you sent):** to _go down_ a staircase, walk _into_ the down-stair tile (often by pressing UP if you're below it). The stair tile teleports you to the lower floor. Same logic for up-stairs: walk into them from above by pressing DOWN. `Tile ahead` in state will say `STAIRS_DOWN` / `STAIRS_UP` so you can plan.
   - **Ledges:** small step graphics. You can _jump down_ by walking into them in the direction of the jump (usually south). You CANNOT jump up — go around.
   - **Surfing:** entering water requires HM Surf and having a Pokémon that knows it. From the shore, face water and press A.
   - **Cut / Strength / Rock Smash trees & rocks:** face them, A, choose to use the HM.
   - **Dialog Yes/No:** when a Yes/No prompt appears mid-dialog, mashing A picks the highlighted option (usually YES). Always read the screenshot after the prompt-text box before pressing.
   - **Bike on-route only:** can't use the bike indoors.
   - **PC / Save / Heal:** PC is for box management (deposit/withdraw). Heal is at Pokémon Centers via the nurse (talk to her, A).
   - **Hidden Machines (HMs):** taught permanently, can't be forgotten without the Move Deleter (Lilycove). Don't fill all 4 move slots with HMs.

8. **Combat (turn-based battles).** Menu: FIGHT / BAG / POKéMON / RUN. HP bars top-left (opponent) and top-right (yours). Status icons (PSN, PAR, BRN, SLP, FRZ) attach to the HP bar. Type chart (the big ones): Water > Fire/Ground/Rock; Fire > Grass/Bug/Ice/Steel; Grass > Water/Ground/Rock; Electric > Water/Flying; Ground > Electric/Fire/Rock/Steel; Psychic > Fighting/Poison; Dark > Psychic; Ghost > Psychic/Ghost. Switching out costs a turn; running fails vs trainers.

9. **Menus & dialog.** START → main menu (PokéMon / BAG / PLAYER / SAVE / OPTION / EXIT). A confirms, B cancels / closes. SELECT registers a key item. **Don't mash A in dialog** — one press per box, then screenshot.

10. **Hoenn story skeleton** (so the AI can form sensible sub-goals when a dialog references future plot beats):
    - Get starter from Birch on Route 101 (Treecko / Torchic / Mudkip).
    - Rival battle (May/Brendan) on Route 103.
    - Gym 1 — Rustboro, Roxanne (Rock).
    - Devon Corp errand — deliver Devon Goods to Steven on the SS Tidal (no wait, Mr. Briney → Dewford).
    - Gym 2 — Dewford, Brawly (Fighting).
    - Slateport: Capt. Stern, Trick House nearby.
    - Gym 3 — Mauville, Wattson (Electric). Free his New Mauville generator sidequest gives a rebate Pokémon.
    - Gym 4 — Lavaridge, Flannery (Fire). Reach via Mt. Chimney; first Team Magma/Aqua mountain showdown.
    - Gym 5 — Petalburg, Norman (Normal). Player's father.
    - Gym 6 — Fortree, Winona (Flying). Tree-house gym; preceded by Kecleon-on-the-bridge invisible Pokémon.
    - Gym 7 — Mossdeep, Tate & Liza (Psychic, double battle).
    - Gym 8 — Sootopolis, Wallace (Water). Preceded by climax — wake Groudon/Kyogre, calm with Rayquaza.
    - Elite Four & Champion (Steven) at Ever Grande City.

11. **Major sidequests / features** (one-liners so the AI recognizes references):
    - **Contests** (Verdanturf / Slateport / Fallarbor / Lilycove): beauty/cool/cute/smart/tough categories using PokéBlocks.
    - **Secret Bases** (after HM Secret Power): build your hideout in tree holes / bushes.
    - **Berry Master** (Route 123): gives Berries, you grow them in soft soil patches across routes.
    - **Trick House** (Route 110): a series of puzzle rooms keyed to story progress; rewards Eggs, TMs, Berries.
    - **Battle Frontier** (post-game, Battle Tower in vanilla): seven facilities with restricted rulesets.
    - **Trainer Hill / Mirage Island / Faraway Island / Birth Island / Navel Rock**: rare-mythic event islands.
    - **Eon Ticket / Old Sea Map / Mystery Gift tickets**: event distribution.
    - **Fossils** (Mirage Tower / Desert): Anorith vs Lileep choice; only one per save.
    - **Regis** (Regirock / Regice / Registeel): require Relicanth + Wailord and braille puzzles.

12. **Stuck-recovery heuristics.**
    - Two identical screenshots after a directional press → blocked or just turned. Look at `Tile ahead` and `Nearby` in state.
    - A doesn't advance dialog → already at end; B to close.
    - Spinning without moving → switch to held direction (`_d`) or a chord (`3d`).
    - Wild battle you don't want → flee via B then A, or RUN from menu.
    - Truly lost → `pokemonctl state` (map name + position), then screenshot to spot landmarks.

13. **Save discipline** (kept). After badges, new species, ~30 in-game minutes, key items.

14. **Tools (`pokemonctl`)** — kept verbatim from current prompt, with one new bullet: `pokemonctl state` now includes Position, Facing, Tile ahead, and Nearby objects — use it before guessing from pixels.

Test (`packages/discord-plays-pokemon/packages/backend/src/goal/codex-command.test.ts`) keeps existing locked strings (`"Pokémon Emerald"`, `"Stone"`, `"Knuckle"`, `"chord"`, `"pokemonctl state"`, `"pokemonctl history"`, BEGIN/END markers) and adds topical assertions for: tile-grid mention, first-press-turns rule, face-adjacent-A interaction, stair-into-direction rule, dialog Yes/No warning, at least one major sidequest term (`"Contest"` or `"Secret Base"`).

## Files to modify

| File                                                                                           | Change                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/discord-plays-pokemon/packages/backend/src/emulator/symbols.ts`                      | Add `gPlayerAvatar`, `gObjectEvents`, `gMapHeader` to `GAME_SYMBOL_NAMES` + resolved record.                                                           |
| `packages/discord-plays-pokemon/packages/backend/src/emulator/struct-offsets.ts` _(new)_       | Hard-coded offsets for `ObjectEvent`, `PlayerAvatar`, `SaveBlock1.pos`, `SaveBlock1.location`, each commented with the pokeemerald source field.       |
| `packages/discord-plays-pokemon/packages/backend/src/emulator/map-names.ts` _(new, generated)_ | `(mapGroup, mapNum) → name` table. Generator script `scripts/gen-map-names.ts` parses pokeemerald data; commit output.                                 |
| `packages/discord-plays-pokemon/packages/backend/src/goal/types.ts`                            | Extend `GameSnapshot` with `position`, `facing`, `mapName`, `tileAhead`, `nearbyObjects`.                                                              |
| `packages/discord-plays-pokemon/packages/backend/src/goal/snapshot.ts`                         | Populate the new fields via `MemoryReader.u8/u16/s16/bytes`.                                                                                           |
| `packages/discord-plays-pokemon/packages/backend/src/goal/game-state-summary.ts`               | Append `Position:`, `Tile ahead:`, `Nearby:` blocks.                                                                                                   |
| `packages/discord-plays-pokemon/packages/backend/src/goal/game-state-summary.test.ts`          | New `.toContain` assertions for each new line; keep existing baseline.                                                                                 |
| `packages/discord-plays-pokemon/packages/backend/src/goal/codex-command.ts`                    | Rewrite `buildPrompt` body per sections 1–14 above; keep signature + guards + BEGIN/END markers.                                                       |
| `packages/discord-plays-pokemon/packages/backend/src/goal/codex-command.test.ts`               | Keep all existing assertions; add topical assertions for tile grid, first-press-turns, face-adjacent-A, stair rule, dialog Yes/No, one sidequest term. |

No homelab/cdk8s changes (prompt is bundled at image build time; data exposure is internal to the backend). No 1P/secret changes.

## Verification

1. **Local types + tests:**

   ```bash
   cd packages/discord-plays-pokemon
   bun run typecheck
   bun test
   ```

   Expect green; new state-summary and prompt assertions pass; existing locked strings still present.

2. **Snapshot smoke** — extend the existing harness (e.g. the e2e wasm test that boots the rom; per memory `reference_mk64_rom_and_harness` we have ROM in syncthing; pokemon harness will be similar) and dump `formatGameStateForPrompt` from a known save-state. Confirm position / facing / map name / tile-ahead / nearby match what's visible in the screenshot. Include three save-states: outdoors next to NPC, inside a Poké Center, below the stair the user screenshotted.

3. **Prompt render check:**

   ```bash
   cd packages/discord-plays-pokemon
   bun -e 'import { buildPrompt } from "./packages/backend/src/goal/codex-command"; const p = buildPrompt("go down the stairs", { gameStateSummary: "Party: TREECKO L5 19/19\nPosition: Devon Corp 2F (5, 3), facing left\nTile ahead (left): SOLID — wall\nNearby:\n  - STAIRS_DOWN 1 tile north", recentGoalsSummary: "(none)" }); console.log(p.length, "chars"); console.log(p);'
   ```

   Eyeball that the stair gotcha section + new state lines compose cleanly; total in the 5000–7000 char band.

4. **Live behavioral smoke** (after PR merge → Argo deploy to torvalds):
   - `/goal Walk downstairs to the lobby of this building` — replicate the user's stair case. Goal report should show the AI reading `Tile ahead (up): STAIRS_DOWN` from state and choosing to walk up into the tile rather than spinning.
   - `/goal Talk to Professor Birch in his lab` — face-adjacent-A interaction. Should not waste 5+ A presses without facing him.
   - `/goal Walk into tall grass and battle one wild Pokémon` — should use held-direction or paired turn+walk, not single ineffective taps.
   - Compare goal-report cost lines vs the prior nano-era runs (mini is ~5× per token; richer state should reduce screenshots-per-decision, partly offsetting).

5. **PR media:** attach two before/after goal-report screenshots from `pokemonctl progress`, plus a `pokemonctl state` capture showing the new lines populated. Upload via `toolkit pr asset <PR#> ./before.png ./after.png ./state-sample.txt --profile seaweedfs --markdown`.

## Risks & follow-ups

- **Struct-offset drift:** if upstream pokeemerald or `tripplyons/pokeemerald-wasm` reorders fields, offsets break. Mitigation: hard-code with comments naming the source file + git ref; the new state-summary tests against a known-good wasm snapshot would catch drift. Pin the upstream rev in a constant and surface it in a startup log.
- **`tileInFrontBehavior` lookup correctness:** if the map-layout indirection turns out to be more complex than expected (Emerald has metatile _attributes_ per layout, indexed via metatile _id_), the implementer may have to fall back to just emitting the raw metatile-behavior byte and decoding a handful of well-known enum values (STAIRS*DOWN_LEFT/RIGHT, LEDGE*\*, TALL_GRASS, etc.). Acceptable degradation.
- **Map-name table size:** Hoenn has ~300 map IDs; the literal table is ~10 KB committed. Fine.
- **Prompt token bloat:** at ~6000 chars (~1500 tokens) prompt is still <1% of mini's context. Cost per turn rises proportionally — watch the next 24 h of cost lines; if untenable, trim the sidequest section first (highest-bytes, lowest-impact-per-byte).
- **Follow-up (not this PR):** annotated screenshot overlays — render a debug grid + position marker onto the screenshot before the AI reads it. Strictly better than text-only state for spatial reasoning, but requires graphics work in `pokemonctl screenshot`. File a TODO once this lands.

## Session Log — 2026-06-15

### Done

- 1Password swap: pokemon `[game.goal] model` from `gpt-5.4-nano` → `gpt-5.4-mini` (vault `v64ocnykdqju4ui6j6pua56xw4`, item `hwyhh64dyu3s7w37q7oj7r4qn4`), cleaned up a duplicate sectioned `config.toml` field accidentally created by the dot-escape gotcha, K8s secret + pod rollout confirmed live.
- Spatial state surfaced from `pokeemerald-wasm`:
  - `symbols.ts` — added `gPlayerAvatar`, `gObjectEvents` to the resolved record (`gMapHeader` is NOT exported by the current wasm; downgrade noted).
  - New `src/game/spatial/spatial-snapshot.ts` reads player position (`s16` x/y), facing (4-bit DIR*\*), movement mode (PA_FLAG*\* bits), map id, current-tile metatile behavior, and nearby ObjectEvents (≤5-tile manhattan radius, sorted, classified into NPC / ITEM_BALL / CUTTABLE_TREE / BREAKABLE_ROCK).
  - New `src/game/spatial/metatile-behaviors.ts` decodes the ~60 MB\_\* enum values that change action selection (warp arrows, ledges, tall grass, doors, water, PCs, berry soil…).
  - New `src/game/spatial/generated/map-names.ts` (~600-line generated table) covers all Hoenn maps; generator at `scripts/generate-map-names.ts` parses pokeemerald's `data/maps/map_groups.json`. Pinned to the same `tripplyons/pokeemerald-wasm` rev `species.generated.ts` uses (`ed25aa7c5ae9c3c338cc9aa57c7150fc33255ad3`).
  - `MemoryReader` got `s16` (the engine's coord type is `s16`).
- Goal-state plumbing: `formatGameStateForPrompt` accepts an optional `SpatialSnapshot` second arg; renders `Location:`, `Standing on:`, `Nearby objects:` blocks. `GoalManager` + `control-server` + `index.ts` plumbed through with a new `spatialSnapshotProvider`. `goal-process-helpers.ts` extracted to keep `goal-manager.ts` under the per-file line cap.
- `buildPrompt` rewrite — 14 sections covering controls, movement (with first-press-turns as rule #1), screenshot anatomy, combat, Hoenn story skeleton, sidequests, counter-intuitive gotcha catalog (stairs / ledges / surf / Cut / dialog Yes/No / bike / HMs), and stuck-recovery heuristics.
- Tests:
  - `game-state-summary.test.ts` — 7 new cases for spatial lines (no-spatial path, location, standing-on, nearby empty/populated/classified).
  - `codex-command.test.ts` — 7 new prompt-content assertions (tile grid, first-press-turns, face-adjacent-A, stair-warp rule, dialog Yes/No, sidequest terms, spatial-field docs).
  - `emulator-symbols.integration.test.ts` — now also exercises `readSpatialSnapshot` against the real wasm across 200 frames.
- 165/165 backend tests pass; typecheck + lint + prettier all green.
- PR #1261 opened: https://github.com/shepherdjerred/monorepo/pull/1261

### Remaining

- Verify live behavior after Argo deploys the new image:
  - `/goal Walk downstairs to the lobby` (replicate the user's stair-screenshot case)
  - `/goal Talk to Professor Birch in his lab` (face-adjacent-A interaction)
  - `/goal Walk into tall grass and battle one wild Pokémon` (held-direction)
- Follow-up: upstream PR against `tripplyons/pokeemerald-wasm` to export `gMapHeader` (would unlock tile-AHEAD metatile lookups, not just standing-on).
- Follow-up: annotated screenshot overlays — render grid + position marker onto the PNG before the AI reads it. Strictly better than text-only spatial state but needs graphics work in `pokemonctl screenshot`.

### Caveats

- `gMapHeader` is NOT exported by the current wasm. We can read the player's CURRENT-tile behavior but NOT arbitrary tile-ahead behavior. The prompt's "press UP to enter a down-stair" rule is the primary defense for the stair case; standing-on catches the moment the AI has already stepped onto the warp arrow.
- Struct offsets are hard-coded against `tripplyons/pokeemerald-wasm@ed25aa7c5ae9c3c338cc9aa57c7150fc33255ad3`. A wasm rebuild against a different fork or a struct reorder will break reads. The `emulator-symbols.integration.test` is the canary — it boots the actual checked-in wasm and asserts the spatial snapshot read doesn't throw.
- Prompt cost: now ~14k chars (~3500 tokens) up from ~1.5k chars. For `gpt-5.4-mini`, that's ~$0.0009 per goal start, mostly cached on subsequent turns. Watch the next 24h of cost lines; if untenable, trim the sidequest section first.
- Map-name table is ~10 KB committed (well under the 5 MB pre-commit large-files threshold).
- The 1Password gotcha around `op item edit "config.toml[text]=…"` — the dot is parsed as a section separator and creates a NEW sectioned field instead of editing the existing top-level one. Memory `reference_op_item_create_dot_label` updated with the new wrinkle.

## Workflow Friction

- `git commit` looked like it was passing pre-commit hooks (✔️ on every step listed in the lefthook summary) but silently failed to produce a commit because prettier was failing on two files with the same green color as a pass. Per existing memory `reference_lefthook_prettier_green_coloring`: a failed prettier step shows the same green as a pass, and the only signal is the missing "[<branch> <sha>] <subject>" line. The 🥊 emoji in the summary is the only thing differing from the ✔️ on success — that's the actual fail indicator. Worth adding a `lefthook.yml` post-hook that exits nonzero on any 🥊 instead of relying on visual diff between two near-identical glyphs.
