TASK E2 — full build pipeline, aiming for a genuinely good-looking result.

1. Create a `paper` flat sandbox to act as the "source" world. Give it a little context with WorldEdit: one oak tree (e.g. `//generate` or a hand-built trunk + leaves) near x=3, z=3, and a small 3×3 pond near x=16, z=16 (surface level). Do not build anything inside x 6..14, z 6..14.
2. Following the minecraft-building skill: capture the site box x 0..20, y -64..-44, z 0..20 into a build directory under OUT, open a canvas from it, and build a small cottage (footprint about 9×7, centered near x=10, z=10) with a proper foundation, walls with depth, door, windows and a roof. Use the DSL and/or WorldEdit ops as you see fit. Iterate with render + lint and critique against the rubric (at most 4 iterations); look at your renders.
3. Promote the finished build to the source sandbox using the dry-run plan hash, then verify it.

Deliverables: copy the final contact sheet to `OUT/final.png`. `OUT/result.json`: {"sourceSandbox": "<sbx id>", "buildDir": "<path>", "applyId": "<id>", "iterations": <n>, "lintErrors": <n>, "lintWarnings": <n>, "verifyMismatches": <n>, "selfCritique": "<2-4 sentences, honest>"}.
Leave the source sandbox running; remove the canvas sandbox.
