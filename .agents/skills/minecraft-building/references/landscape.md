# Landscape: terrain, water, paths, trees

Terrain makes or breaks a map. Generate heights with `ctx.noise` (see
maps.md), then shape and dress them with these rules.

## Terrain shape

- **Seven-block rule.** Never more than 7 blocks straight on a hillside,
  bank, path or cliff edge; use odd segment lengths (1, 3, 5, 7). No
  regular staircases: mix 1-block steps with 2–3-block runs.
- **Every contour different.** Each height layer's outline differs from the
  layers above and below, and segment ends don't line up vertically, or the
  slope looks combed.
- **Soil at least 2 thick** over rock everywhere.
- **Steep faces are rock.** Any slope steeper than about 1:1 (a column 2+
  above a neighbour) gets stone-palette blocks; gentler ground is soil.
- **Cliffs:** about 3 tiers of ~3 tall, each set back 1; a 1-block grass/dirt
  lip on top with leaves draping over; overhangs at most 1–2 with stone
  undersides; coves and buttress pillars break the face. Texture default:
  60% `stone`, 15% `andesite`, 10% `cobblestone`, 8% `tuff`, 5%
  `stone_bricks`, 2% `mossy_cobblestone`, accents as singles or small L's;
  moss only in grooves and under ledges.
- **Strata** follow the landform (hard rock over softer, the soft band
  eroded back), never flat horizontal stripes.
- **Mountains:** several peaks and sub-points, never one cone; ridgelines
  offset from the peaks; gullies between ridges; the foot flares out and
  collects soil. Altitude zones: trees → grass → bare rock → snow. Warm
  climates use `terracotta`, `granite`, `sand`; cold ones grey stone.
- **Boulders:** lumpy or tall-narrow, never spheres; small rocks around big
  ones; sink each into the ground.
- **Surface in three tiers.** Grass hill: `grass_block`, then `coarse_dirt`,
  `podzol`, `rooted_dirt` patches, then `leaf_litter`, `wildflowers`,
  `short_grass`. Rock: `stone`, then `andesite`, `cobblestone`, `gravel`,
  `tuff`, then `moss_carpet`, `glow_lichen`, `vine`.

## Water

- Rivers run downhill in S-curves with odd runs; steeper bank on the outside
  of a bend, gravel on the inside. Streams 1–2 wide, rivers 3–9, widening
  downstream and flaring at the mouth.
- Depth about equal to width up to 3; wide rivers 3–4 deep in the middle,
  1–2 at the edges; lakes 1–3 at the shore. No skinny deep channels.
- Bank gradient outward: `mud` → mud and `clay` → `dirt` and `gravel` →
  broken row of `coarse_dirt`/`rooted_dirt` → grass. Bed of dirt or coarse
  dirt with sand and gravel patches and `seagrass`.
- Waterfalls on steep upper reaches: a hard caprock, a plunge pool with
  boulders; the base messier than the top.
- Beaches: shallow slope into water, sand widening landward, dunes backed by
  `coarse_dirt`, a tree line behind; `dead_bush` driftwood; kelp only 2+ deep.
- `lily_pad` in still corners; reeds in a few big groups plus singles.

## Paths and roads

- Never one block type. Rural core about 65% `dirt_path`, 20% `coarse_dirt`,
  10% `gravel`, 5% `packed_mud`; edge band coarse dirt, path and grass.
  Town streets `stone`, `andesite`, `stone_bricks`, mossy only at the edges.
- Lay a centreline with odd runs (≤7 straight, shift diagonally, no square
  corners), widen it, then nibble the edge by single blocks.
- Widths: garden 2–3, lane 3–5, main street 5–7. Slabs at raised ends,
  stairs on slopes, never full-block inclines; a flat landing at every door.

## Trees and plants

- **No lollipops.** Use `craft.tree` (branch-first trunks of `*_wood`,
  kinked, leaves at the branch tips, domed canopies with wispy diagonal
  edges and mixed leaves), and several species, sizes and seeds.
- Large trees taper from about 3×3; roots only on big trees, flared 2–3 up
  the trunk; on cliffs roots hang down the face.
- Mixed leaves: ~75% base, ~20% a second type, ~5% `flowering_azalea_leaves`
  or a third. Leaves placed by programs need `persistent=true`.
- A forest of normal trees beats one mega-tree; vary height, rotate variants.
- Bushes: small curved clumps 1–2 tall in groups, two leaf types, `azalea`
  on `coarse_dirt`.
- Flowers: clump by species, at most 2 colours per area, mostly
  `short_grass` (`grass` is not a block id). `tall_grass`/`large_fern` in
  corners and against walls, `leaf_litter` under trees. Leave some coarse
  dirt showing; don't grass every block.
- Vegetation is densest along water and thins into open ground and near
  paths and settlements; biomes blend over 10–30 blocks, never a hard line.

## Building meets terrain

- Foundations go down until no dirt shows under any wall, stepped deeper
  downhill; timber houses sit on about 3 rows of stone.
- Retaining walls follow the terrain in mixed stone, their tops varying
  (at most 2 neighbours at one height), slabs at the steps.
- Plant every base: mixed-leaf bushes, tall grass against the walls, 1–2
  flower colours, and a tree beside the building ("the failsafe").
- Build into slopes rather than flattening them; taper cut and fill back to
  natural ground, longer tapers for taller earthworks.

## Sources

BlueNerd, landscaping and terraforming tips (minecraft.net and video);
Minecraft Wiki terraforming tutorials; Grian, How To Make Better Trees;
BdoubleO100, Build School: Custom Trees; WesterosCraft exteriors;
Conquest Reforged gradients.
