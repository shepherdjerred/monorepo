TASK E6 — precise WorldEdit build in negative coordinates.

In a fresh `paper` sandbox with a flat world (grass surface at y=-61, so the first block above ground is y=-60), build this tower in world `world`. Every coordinate is negative on x and z; pass them to `toolkit mc` exactly as written.

1. A hollow cylindrical tower of `minecraft:deepslate_bricks`, centered on x=-20, z=-20, outer radius 4 (WorldEdit `//hcyl` radius semantics), from y=-60 up to and including y=-47 (14 blocks tall). Inside the walls is air at every height.
2. A doorway: the two wall blocks at x=-20, z=-16 for y=-60 and y=-59 are air (y=-58 above them stays deepslate bricks).
3. A window: the two wall blocks at x=-20, z=-24 for y=-55 and y=-54 are `minecraft:glass`.
4. Crenellations: on top of the wall ring at y=-46, alternate deepslate bricks and air around the ring (roughly every other ring position filled). Nothing at y=-45 or above.
5. Nothing else may be placed outside the tower.
6. Read back the region x -26..-14, y -61..-44, z -26..-14 with `toolkit mc region read` and save it to `OUT/region.json`.

Deliverable `OUT/result.json`: {"sandbox": "<sbx id>", "commands": ["…every toolkit mc command you ran that changed the world…"], "selfCheck": "<how you verified>", "cliProblems": "<any argument-parsing trouble you hit, or none>"}.
