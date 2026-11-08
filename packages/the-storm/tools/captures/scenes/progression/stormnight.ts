import { z } from "zod";
import {
  defineCaptureScene,
  type CaptureContext,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import shots from "#captures/presentations/progression/stormnight.ts";
import { presentation } from "#captures/presentations/lookup.ts";

const config = z
  .object({
    events: z.array(
      z.object({
        id: z.string(),
        rewards: z.array(
          z.object({
            material: z.string(),
            amount: z.number().int().positive(),
          }),
        ),
      }),
    ),
  })
  .parse(
    Bun.YAML.parse(
      await Bun.file(
        new URL(
          "../../../../server/owned/plugins/TheStorm/seasonal.yml",
          import.meta.url,
        ),
      ).text(),
    ),
  );
const event = config.events.find((candidate) => candidate.id === "stormnight");
if (!event) throw new Error("Missing authored Stormnight rewards");
const rewards = event.rewards;
async function aimDoor(context: CaptureContext) {
  const observed = [];
  // An open door's panel sits at the edge of its block, leaving the centre empty.
  for (const [x, zz] of [
    [69.08, 66.5],
    [69.92, 66.5],
    [69.5, 66.08],
    [69.5, 66.92],
  ] as const) {
    await context.lookAt([x, 70.1, zz]);
    const state = await context.status();
    observed.push(
      state.connected
        ? { position: state.position, target: state.target }
        : state,
    );
    if (
      state.connected &&
      state.target.kind === "block" &&
      state.target["type"] === "minecraft:spruce_door"
    )
      return;
  }
  throw new Error(
    `The camera cannot reach the authored Stormnight door panel: ${JSON.stringify(observed)}`,
  );
}
export default defineCaptureScene({
  name: "stormnight-door",
  description:
    "Claim a real seasonal door reward in the isolated annual-event preset",
  bounds: { min: [-4, -2, -4], max: [6, 6, 6] },
  staging: [-2.5, 0, -2.5],
  inspectors: [],
  setup: async (context) => {
    await context.command(`minecraft:gamemode survival ${context.name}`);
    await context.command(`minecraft:clear ${context.name}`);
    await context.action("hotbar", { slot: 0 });
    await context.teleport([67.5, 69, 66.5], 0, 0);
    const door = await context.block([69, 69, 66]);
    if (
      !door.startsWith("minecraft:spruce_door[") ||
      !door.includes("half=lower")
    )
      throw new Error("Authored Stormnight door is missing");
    await aimDoor(context);
  },
  run: async (context) => {
    await context.action("clear-overlays");
    await context.capture(presentation(shots, "stormnight-door"));
    await context.use();
    await context.feedback("Stormnight:");
    await context.waitFor(
      "configured trick-or-treat reward",
      (s) =>
        s.connected &&
        rewards.some((reward) =>
          s.inventory.some(
            (item) =>
              item.type === `minecraft:${reward.material.toLowerCase()}` &&
              item.count === reward.amount,
          ),
        ),
    );
    await context.lookAt([-15, 73, 30]);
    await context.action("chat-open");
    await context.capture(presentation(shots, "stormnight-reward"));
    await context.action("close");
    await aimDoor(context);
    await context.use();
    await context.feedback("You already visited this door today.");
  },
});
