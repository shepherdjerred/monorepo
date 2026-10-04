import { defineScenario } from "@shepherdjerred/mc-harness/playtest/define.ts";

// Port of tests/e2e/mechanics.e2e.test.ts "super-push moves the vanilla piston
// load…": the mechanics E2E plugin builds an east-facing piston at 408,-45,0
// with a [SuperPush] sign and two stone blocks ahead of it. Here an actor
// places the redstone block (a real BlockPlaceEvent) instead of a console
// setblock.
const piston = { x: 408, y: -45, z: 0 };
const trigger = { x: 408, y: -45, z: 1 };
const destinations = [
  { x: 414, y: -45, z: 0 },
  { x: 415, y: -45, z: 0 },
];

export default defineScenario({
  name: "storm mechanics: super-push carries the piston load four extra blocks",
  description:
    "Powering a [SuperPush] piston by placing a redstone block moves its load past the vanilla extension",
  requires: {
    profiles: ["storm-dev"],
    plugins: ["TheStorm", "TheStormMechanicsE2E"],
  },
  actors: { engineer: { at: { x: 406, y: -60, z: 1 }, gameMode: "CREATIVE" } },
  region: { min: { x: 406, y: -46, z: -1 }, max: { x: 417, y: -44, z: 2 } },
  timeoutMs: 60_000,
  async run({ actors: { engineer }, step, expect }) {
    await step("the fixture built an east-facing piston", async () => {
      await expect.block(piston).toBe("minecraft:piston[facing=east]");
    });

    await step("the actor powers the piston", async () => {
      await engineer.place(trigger, "minecraft:redstone_block");
      await expect
        .event({
          type: "block_place",
          player: "engineer",
          text: "minecraft:redstone_block",
        })
        .within(2000);
    });

    await step("the load lands four blocks past the vanilla push", async () => {
      for (const at of destinations) {
        await expect
          .block(at)
          .eventually("minecraft:stone", { within: 10_000 });
      }
    });
  },
});
