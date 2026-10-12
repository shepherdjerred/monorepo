TASK E3 — write and run a playtest.

Write a playtest scenario at `packages/mc-harness/playtests/eval-lever-lamp.playtest.ts` (you may create this one repository file). It must, on the `paper` profile:

- in `setup`, build a small redstone fixture near x=20, z=20: a `minecraft:redstone_lamp` with a `minecraft:lever` attached so that flipping the lever powers the lamp;
- spawn a Citizens actor `alice` next to it;
- `alice` uses the lever; assert the lamp becomes lit (`lit=true`);
- `alice` breaks the lever; assert the lamp turns off (`lit=false`);
- assertions must be real checks of world state, not just "no error".

Run it with `toolkit mc playtest run` until it passes. Deliverable `OUT/result.json`: {"scenario": "<path>", "runId": "<id>", "status": "passed|failed", "attempts": <n>}.
(For this task you may tear down the sandbox the playtest created; the grader reruns your scenario.)
