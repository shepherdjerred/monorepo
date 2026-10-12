import { defineScenario } from "@shepherdjerred/mc-harness/playtest/define.ts";

// The harness's own end-to-end check: one Citizens actor walks, runs a
// command, breaks and places blocks, uses a lever and chats, and every effect
// is asserted from world state or the event stream.
const workbench = { x: 6, y: -60, z: 0 };
const lever = { x: 4, y: -60, z: 1 };
const lamp = { x: 4, y: -60, z: 2 };

export default defineScenario({
  name: "harness smoke: an actor walks, builds and uses redstone",
  description:
    "Proves the paper profile: Citizens actors, PlayerInteractEvent use, block events and chat",
  requires: { profiles: ["paper"] },
  actors: { alice: { at: { x: 0, y: -60, z: 0 }, op: true } },
  region: { min: { x: -2, y: -61, z: -2 }, max: { x: 8, y: -57, z: 4 } },
  timeoutMs: 90_000,
  async setup({ command }) {
    // Clear what an earlier run on the same sandbox left behind.
    await command("fill -2 -60 -2 8 -57 4 minecraft:air");
    await command("setblock 6 -60 0 minecraft:oak_planks");
    await command("setblock 4 -60 2 minecraft:redstone_lamp");
  },
  async run({ actors: { alice }, step, expect }) {
    await step("walk to the workbench", async () => {
      await alice.goto(
        { x: 5, y: -60, z: 0 },
        { range: 1.5, timeoutMs: 20_000 },
      );
    });

    await step("run an operator command as the actor", async () => {
      await alice.command("/time set 6000");
      await expect.command("time query day").toMatch(/is at 6\d{3} tick/u);
      await expect
        .event({ type: "command", player: "alice", text: "/time set 6000" })
        .within(2000);
    });

    await step("break the workbench", async () => {
      await alice.break(workbench);
      await expect.block(workbench).toBe("minecraft:air");
      await expect
        .event({
          type: "block_break",
          player: "alice",
          text: "minecraft:oak_planks",
        })
        .within(2000);
    });

    await step("place and pull a lever to light the lamp", async () => {
      await alice.place(lever, "minecraft:lever[face=floor,facing=north]");
      await alice.use(lever);
      await expect.block(lever).toBe("minecraft:lever[powered=true]");
      await expect.block(lamp).eventually("minecraft:redstone_lamp[lit=true]", {
        within: 3000,
      });
    });

    await step("chat through the server's chat pipeline", async () => {
      await alice.chat("smoke test complete");
      await expect.chat(alice, "smoke test complete").within(3000);
    });
  },
});
