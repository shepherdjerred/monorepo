# Building craft: shape, depth and roofs

Distilled from established builder guides (sources at the end). Apply while
authoring, then check with the rubric. Numbers are defaults, not laws.

## The five that matter most

1. **Massing before detail.** 2–4 overlapping volumes (main block, wing,
   porch/tower/annexe) with an L or T footprint and 2–3 roof heights. Pull
   the entrance bay 1 forward and 1 up. Texture and detail come last.
2. **Never one flat plane.** Frame 1 proud of infill, openings recessed 1,
   every roof overhangs (1 at eaves and gable ends, 2 at the peak).
3. **Change material only where depth changes.** Logs against planks or
   stone against plaster never meet flush; step one by a block, stair or
   trapdoor.
4. **Odd widths** (5, 7, 9, 11) so a gable has a one-block ridge and doors
   and windows centre. Even widths only for double doors or one-sided roofs.
5. **Negative space.** Detail frames structure; keep plain wall fields.
   Densest detail at the entrance and eye level, finish every side.

## Shape and proportion

- Footprint about 3:5 (9×15, 11×19); never longer than 3× the width.
  Columns about 1:7. Break long faces into bays and vary section heights.
- Player scale: doors 2, ceilings ≥3 clear (no 2-tall rooms), rooms 4–5,
  halls 7–12; floor-to-floor 4 for cottages, 5–6 for grand buildings.
- Size follows wealth and type: shacks 1 storey, farmhouses 1–2, town houses
  3 storeys and rarely over 8×10, landmarks 2–3× the typical eave height.
- Raise the ground floor 1–3 on a plinth with a stepped entry.
- Asymmetry for houses; civic and religious buildings may be symmetric but
  need a clear focal point.
- Check the silhouette in the hero/iso views: chimneys, towers and dormers
  must break the roofline; if a zoomed-out view reads as noise, simplify.

## Depth and openings

- Feature walls have 3 layers: frame (depth 0), infill (−1), glass (−1/−2).
  Focal entrances get more. A jetty (upper storey 1 forward) beats any
  texture change. `craft.walls` with `depth: 1` gives the base layer.
- `glass_pane` or muted stained panes, never full `glass` in a wall.
  Medieval windows 1×1 or 1×2, castle slits 1×2/1×3, modern ≥2×2.
- Window kit (2–3 per style): trapdoor shutters, upside-down stair lintel,
  slab or stair sill, window box. Door recessed 1 with windows about 1 away.
- A separator band (stripped log, stair course or foundation block) between
  storeys.
- Timber posts about every 3 blocks, with some 1- and 2-wide panels so the
  rhythm is not mechanical; one frame colour per building and settlement.
- Detail blocks by role: stairs (lintels, sills, corbels, eaves), slabs
  (ledges), trapdoors (shutters, awnings, sub-block depth), walls/fences
  (posts, balusters, chimney caps), buttons (studs), `iron_chain` and
  `lantern` (hanging). The chain block is `iron_chain`; `chain` fails.
- Every projection has a reason: eaves, buttresses, reveals, sills. Grand
  walls are thicker at the base.
- Props that enlarge the footprint without walls: porch, pergola, lean-to,
  cart, barrels. One or two climbing-leaf bushes per house, not everywhere.

## Roofs

- Pitch from blocks: stairs 45°, alternating slabs 22.5°, full blocks 2-up
  ~63°. Motifs give custom pitches (slab, upside-down stair, stair ≈ 5:7).
- One roof style per village; vary pitch and height per house.
- Gable for village houses up to ~12 wide; hip for square plans; gambrel for
  barns; mansard (with dormers) only on large urban buildings (≥16×20);
  helm or conical on towers; flat roofs always get a lip, gutter or parapet.
- Over ~15×15, split into 2–3 sections with 5–7 block rises meeting at
  valleys; a single huge gable reads like a barn.
- Dormers and side roofs stay lower and smaller than the main roof and
  repeat its trim. At most one window per gable end.
- Eaves: overhang 1 (2 at the peak), a contrasting trim course, optional
  upside-down stair underhang and stair or trapdoor rafters.
- Ridge: one block on an odd span, capped with upside-down stair, slab or a
  wall/fence spike. A chunkier A-frame: stair, upside-down stair beside it,
  full block on top, repeat.
- Curves: bell/bonnet roofs flatten toward the ridge; Japanese roofs start
  flat at the eave and steepen (slab → stair → full block), corners low.
- Weather roofs along the slope: lighter ridges, darker or mossy eaves and
  valleys, two woods on wooden roofs; poor houses get a frayed edge.
- Chimney off the ridge at a gable end or outer wall, ≥2 above the ridge,
  offset not centred; brick or stone with a `campfire` (`craft.chimney`
  with `cap: "campfire"`).

## Sources

Minecraft Wiki roof guidelines and types; WesterosCraft exteriors; Lux's
Medieval Building Tips (Planet Minecraft); zOrg's 40 Rules for Large Builds;
Raeyzeus' Top 5 Building Tips (minecraft.net); Grian, 35 Small Ways To
Improve Your House; Welsknight, The Importance of Depth; Blondskunk, How to
Add Depth; BdoubleO100, Building with BdoubleO.
