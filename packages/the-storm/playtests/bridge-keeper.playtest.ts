import { defineScenario } from "@shepherdjerred/mc-harness/playtest/define.ts";

// Port of tests/e2e/mechanics.e2e.test.ts "preserves bridge blocks…": the
// mechanics E2E plugin builds a [Bridge] span at x 400 (keeper sign at
// 400,-55,0, deck 400,-54,1..3). A Citizens actor right-clicks the keeper sign
// instead of a Mineflayer bot.
const keeperSign = { x: 400, y: -55, z: 0 };
const deck = [1, 2, 3].map((z) => ({ x: 400, y: -54, z }));
// Bridges move at most once per structureCooldownTicks (20).
const COOLDOWN_MS = 1200;

export default defineScenario({
  name: "storm mechanics: the bridge keeper sign stores and restores the deck",
  description:
    "Right-clicking a [Bridge] keeper sign stores the oak deck in the sign and a second click puts it back; breaking the sign hands back the stored stock",
  requires: {
    profiles: ["storm-dev"],
    plugins: ["TheStorm", "TheStormMechanicsE2E"],
  },
  // Op stands in for the mechanic track levels the E2E plugin grants on join;
  // actors never join.
  actors: { keeper: { at: { x: 402, y: -56, z: 0 }, op: true } },
  region: { min: { x: 398, y: -57, z: -2 }, max: { x: 402, y: -53, z: 5 } },
  timeoutMs: 90_000,
  async run({ actors: { keeper }, step, expect, sleep, command }) {
    await step("the fixture built a keeper sign", async () => {
      await expect.block(keeperSign).toBe("minecraft:oak_wall_sign");
    });

    await step("first click stores the deck", async () => {
      await keeper.use(keeperSign);
      for (const at of deck) {
        await expect.block(at).eventually("minecraft:air");
      }
    });

    await step("second click restores the deck", async () => {
      await sleep(COOLDOWN_MS);
      await keeper.use(keeperSign);
      for (const at of deck) {
        await expect.block(at).eventually("minecraft:oak_planks");
      }
    });

    await step(
      "breaking the keeper sign hands back the stored stock",
      async () => {
        await sleep(COOLDOWN_MS);
        await keeper.use(keeperSign);
        for (const at of deck) {
          await expect.block(at).eventually("minecraft:air");
        }
        await keeper.break(keeperSign);
        await expect
          .block(keeperSign)
          .eventually("minecraft:air", { within: 3000 });
        const held = await keeper.observe();
        const inInventory = held.inventory
          .filter((stack) => stack.item === "minecraft:oak_planks")
          .reduce((sum, stack) => sum + stack.count, 0);
        const dropped = await command(
          'execute positioned 400 -55 0 run data get entity @e[type=minecraft:item,nbt={Item:{id:"minecraft:oak_planks"}},distance=..6,sort=nearest,limit=1] Item',
        );
        const droppedText = dropped.output.join("\n");
        expect.that(
          "3 oak planks come back to the actor or drop at the sign",
          inInventory === 3 || droppedText.includes("count: 3"),
          `inventory ${inInventory.toString()}; nearby item: ${droppedText}`,
        );
      },
    );
  },
});
