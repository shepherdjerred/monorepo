# Palettes, gradients and texture

## Rules

- A small building uses 4–5 blocks: frame/pillar, 1–2 detail, wall, roof.
  Split about 50–60% primary (walls), 30% secondary (frame, roof, trim),
  10–20% accent. Large builds may use 15–30 blocks, but every colour
  repeats in 2–3 places; no isolated one-off clusters.
- Order candidates by **value** (light → dark) first, then hue, then
  texture. Value contrast carries the design: dark frame on light infill
  (`dark_oak_log` on `white_terracotta`) or the reverse; never two
  mid-browns, never the same block for wall and roof edge.
- Dark to light, bottom to top: rough, dark and mossy at the base, corners
  and drip points; lighter and cleaner higher up. Darker rows just under an
  overhang push it visually forward.
- Prefer primaries with stair, slab and wall variants so details stay in
  palette. `calcite`, `dripstone_block`, `packed_mud`, `coarse_dirt`,
  `quartz_pillar`, every `*_concrete` and `*_terracotta` have none: detail
  them with `mud_brick_*`, `granite_*`, `tuff_*`, `polished_tuff_*`,
  `smooth_sandstone_*` or `smooth_quartz_*`.
- Roofs usually sit darker than walls; steep roofs read better dark,
  shallow roofs lighter. Warm roofs (spruce, dark oak, bricks, granite)
  suit cool stone walls.
- One dominant wood plus at most one accent wood per building
  (oak+birch, oak+jungle, jungle+spruce); dark oak reads wealthy.
- Terracotta is the default earthy/plaster colour; concrete is flat and
  saturated (modern, or a white/light-grey blend block); wool is a blend
  block or accent, never a bright primary. Saturated colours small and
  grouped.
- Keep busy patterned blocks apart: glazed terracotta, `chiseled_*`, ores,
  `bookshelf`, `crafting_table`.

## Gradients and texture

- 3–6 steps on a house, more on a tower. Each step spans about 3 rows:
  first row 100%, next a few, third very few. Never alternate one-on,
  one-off ("teeth").
- Blend in irregular clusters radiating from a focal area, varied in size,
  never in rows or columns. Use `mat.noise` (coherent patches) or
  `mat.gradient`, not salt-and-pepper `%` mixes.
- Avoid the three faults: **splattering** (skipped palette steps),
  **smallpox** (uniform patchy noise), **sandwiching** (horizontal
  stripes).
- Weather where it really happens: base, under sills, drip points, roof
  valleys; sun-bleached ridges.
- Base gradient for a stone plinth: bottom 1–2 rows ~40% `mossy_cobblestone`,
  40% `cobblestone`, 20% `andesite`; next 1–2 rows `stone_bricks` with ~15%
  `mossy_stone_bricks` and ~10% `cracked_stone_bricks`; then the wall.

## Proven palettes

| Style            | Walls                                  | Frame / structure                           | Accent                                                       | Roof                                         | Trim / base                                 |
| ---------------- | -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------- |
| Medieval timber  | `white_terracotta`, `calcite`          | `stripped_dark_oak_log`, `dark_oak_log`     | `spruce_trapdoor`, `lantern`, brown panes                    | `spruce_stairs` + `dark_oak_stairs` streaks  | `cobblestone`, `stone_bricks`, mossy cobble |
| Rustic cottage   | `oak_planks`, `stripped_oak_log`       | `spruce_log`                                | `spruce_trapdoor`, `oak_fence`, flower pots                  | `spruce_stairs` or `dark_oak_stairs`         | `cobblestone`, `stone_bricks`               |
| Castle           | `stone_bricks`, `stone`                | cracked/mossy stone bricks (~15%), andesite | `dark_oak_planks`, `cobblestone_wall`, `iron_bars`           | `deepslate_tile_stairs` or `dark_oak_stairs` | `deepslate_bricks`, `cobbled_deepslate`     |
| Dark keep        | `deepslate_bricks`, `deepslate_tiles`  | `polished_deepslate`, `tuff`                | `soul_lantern`, `iron_chain`, `iron_bars`                    | `deepslate_tile_stairs`                      | `cobbled_deepslate`, blackstone bricks      |
| Gothic chapel    | `stone_bricks`, `tuff_bricks`          | `polished_andesite`, `quartz_pillar`        | `chiseled_stone_bricks`, pale panes, one rose window         | steep `dark_oak_stairs` / deepslate tiles    | `andesite`, `polished_tuff`                 |
| Nordic longhouse | `spruce_planks`, `stripped_spruce_log` | `dark_oak_log`, `spruce_log` ridgepole      | `spruce_trapdoor`, banners, `campfire`                       | `spruce_stairs` 45–50° or `moss_block` sod   | `cobbled_deepslate`, `cobblestone`          |
| Desert           | `smooth_sandstone`, `cut_sandstone`    | `sandstone`, `stripped_acacia_log`          | `chiseled_sandstone`, cyan/blue terracotta                   | flat `smooth_sandstone_slab` parapet         | `sandstone_wall`, `red_sandstone`           |
| Adobe            | `packed_mud`, `mud_bricks`             | `terracotta`, `brown_terracotta`            | `stripped_spruce_log` vigas, `decorated_pot`                 | flat, `mud_brick_slab` parapet               | `mud_brick_wall`, `granite`                 |
| Japanese         | `white_terracotta` panels, dark planks | `dark_oak_log` posts every 4                | `spruce_trapdoor` screens, `bamboo_block`; red only on torii | concave `deepslate_tile_*` or dark oak       | `stone_bricks` plinth, gravel gardens       |
| Elven            | `calcite`, `polished_diorite`          | `birch_log`, `stripped_birch_log`           | `amethyst_block`, `sea_lantern`                              | `dark_prismarine_stairs` or `warped_stairs`  | `smooth_quartz`, `polished_andesite`        |
| Dwarven          | `deepslate_bricks`, blackstone bricks  | `polished_basalt`, `polished_deepslate`     | `gold_block`, `cut_copper`, `lantern`                        | `deepslate_tile_stairs`                      | `cobbled_deepslate`, `blackstone`           |
| Industrial       | `bricks`, `mud_bricks`                 | `dark_oak_planks`, `polished_blackstone`    | cut copper → oxidized gradient, `iron_chain`                 | `oxidized_cut_copper_stairs`                 | `polished_basalt`, `stone_bricks`           |
| Modern           | `white_concrete`, `smooth_quartz`      | `light_gray_concrete`, `polished_tuff`      | gray panes, `black_concrete`, `copper_bulb`                  | flat `smooth_stone_slab` edge                | `polished_andesite`, `tuff_bricks`          |
| Cherry cottage   | `cherry_planks`, `stripped_birch_log`  | `stripped_cherry_log`                       | `flowering_azalea_leaves`, `pink_petals`                     | `cherry_stairs`                              | `mossy_cobblestone`, `stone_bricks`         |

Thatch never mixes two materials and needs ≥45°; stand-ins are
`hay_block` or `bamboo_mosaic_stairs`.

## Sources

WesterosCraft Gradients and Exteriors; Conquest Reforged, Gradienting your
Builds; Grian, One trick to change the way you build; BdoubleO100, Build
Texture Breakdown; Raeyzeus' Top 5 Building Tips; Lux's Medieval Building
Tips; Minecraft Wiki block pages (ids checked against the 26.2 registry).
