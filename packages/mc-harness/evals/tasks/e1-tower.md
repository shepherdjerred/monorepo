TASK E1 — precise WorldEdit build.

In a fresh `paper` sandbox with a flat world (grass surface at y=-61, so the first block above ground is y=-60), build this tower in world `world`:

1. A hollow cylindrical tower of `minecraft:stone_bricks`, centered on x=0, z=0, outer radius 4 (WorldEdit `//hcyl` radius semantics), from y=-60 up to and including y=-47 (14 blocks tall). Inside the walls is air at every height.
2. A doorway: the two wall blocks at x=0, z=4 for y=-60 and y=-59 are air (y=-58 above them stays stone bricks).
3. A window: the two wall blocks at x=0, z=-4 for y=-55 and y=-54 are `minecraft:glass`.
4. Crenellations: on top of the wall ring at y=-46, alternate stone bricks and air around the ring (roughly every other ring position filled). Nothing at y=-45 or above.
5. Nothing else may be placed outside the tower.

Deliverable `OUT/result.json`: {"sandbox": "<sbx id>", "commands": ["…every toolkit mc command you ran that changed the world…"], "selfCheck": "<how you verified>"}.
