TASK E5 — a two-story house on real terrain, aiming for a genuinely good-looking result.

1. Create a `paper` flat sandbox to act as the "source" world and sculpt a hillside in it with exactly this WorldEdit op (raw coordinates; it fills a slope that rises from y=-61 at the x=0,z=0 corner to about y=-51 at the x=30,z=30 corner):
   `toolkit mc we --world world --pos1 0,-61,0 --pos2 30,-50,30 "//generate -r grass_block y <= -61 + (x + z) / 6"`
   Confirm the slope exists (region read or capture heightmap) before building.
2. Following the minecraft-building skill: capture the site box x 0..30, y -64..-30, z 0..30 into a build directory under OUT, open a canvas from it, and build a **two-story** house near the middle of the slope (footprint about 9×7 to 11×9) that adapts to the slope: a foundation that meets the terrain on every side (no floating corners, no buried doors), walls with depth, a door reachable from the ground, windows on both floors, a **hip roof** (sloping on all four sides), and a **chimney**. Use the DSL and/or WorldEdit ops — WorldEdit-only solutions are valid (e.g. stairs placed with `//set` / `//faces` / `//replace` masks). Iterate with render + lint and critique against the rubric (at most 4 iterations); look at your renders.
3. Promote the finished build to the source sandbox using the dry-run plan hash, then verify it.

Deliverables: copy the final contact sheet to `OUT/final.png`. `OUT/result.json`: {"sourceSandbox": "<sbx id>", "buildDir": "<path>", "applyId": "<id>", "site": {"min": [x, y, z], "max": [x, y, z]}, "iterations": <n>, "lintErrors": <n>, "lintWarnings": <n>, "verifyMismatches": <n>, "selfCritique": "<2-4 sentences, honest, with rubric scores>"}.
Leave the source sandbox running; remove the canvas sandbox.
