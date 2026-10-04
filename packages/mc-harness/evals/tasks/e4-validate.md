TASK E4 — validate a game-mechanics question by experiment (not from memory).

On a `paper` sandbox, empirically determine:
(a) A furnace is loaded with 8 `raw_iron` (input) and 1 `coal` (fuel). A hopper directly below the furnace feeds a chest below it. Exactly 30 seconds (600 ticks) after loading, how many `iron_ingot` are in the chest, and how many `raw_iron` remain in the furnace input slot?
(b) Does a hopper placed directly on top of a furnace insert items into the furnace's input slot (vs. fuel slot)? Build this as a separate furnace with a hopper above it holding `raw_iron`.

Design the experiment so the result is trustworthy (think about whether the chunk is actually ticking). Measure; don't guess.

After measuring, leave both setups in place and freeze the game (`tick freeze`) so the grader can inspect exactly the state you measured. Use world `world`.

Deliverable `OUT/result.json`:
{"ingotsInChest": <n>, "rawIronRemaining": <n>, "topHopperFillsSlot": "input|fuel|none", "positions": {"furnace": [x, y, z], "hopper": [x, y, z], "chest": [x, y, z], "topHopperFurnace": [x, y, z]}, "sandbox": "<sbx id>", "evidence": ["…commands and the outputs that prove each answer…"], "caveats": "<anything that could make the numbers off by one>"}
