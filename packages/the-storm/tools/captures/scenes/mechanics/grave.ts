import { defineCaptureScene } from "@shepherdjerred/mc-harness/capture/define.ts";
import { pad, camera, inspectors } from "#captures/scenes/fixtures.ts";
import shots from "#captures/presentations/mechanics/grave.ts";
import { presentation } from "#captures/presentations/lookup.ts";
import { z } from "zod";

export default defineCaptureScene({
  name: "lava-grave-recovery",
  description:
    "A real lava death leaves a recoverable grave at the player's last safe position",
  bounds: { min: [0, -1, 0], max: [10, 5, 10] },
  staging: [-2.5, 0, -2.5],
  inspectors,
  setup: async (context) => {
    await pad(context, [10, 5, 10]);
    await context.set(
      context.at(4, 0, 4),
      context.at(6, 0, 6),
      "minecraft:stone_bricks",
    );
    await context.set(
      context.at(5, 0, 5),
      context.at(5, 0, 5),
      "minecraft:lava[level=0]",
    );
    await camera(context, [2.5, 0, 2.5], [2.5, 1.62, 6.5]);
    await context.action("move", { buttons: ["forward"], ticks: 5 });
    await context.command(`minecraft:give ${context.name} minecraft:diamond 3`);
  },
  run: async (context) => {
    const safe = await context.status();
    if (!safe.connected)
      throw new Error("Grave camera disconnected before the last safe step");
    await context.command(
      `minecraft:tp ${context.name} ${context.at(5.5, 0, 5.5).join(" ")}`,
    );
    await context.waitFor(
      "actual lava death",
      (s) => s.connected && s.health <= 0,
      30_000,
    );
    await context.action("respawn");
    await context.waitFor(
      "respawn alive",
      (s) => s.connected && s.health > 0 && s.screen === "",
    );
    await context.playerCommand("graves", "Your graves:");
    await context.feedback("in world:");
    const { messages } = z
      .object({ messages: z.array(z.object({ text: z.string() })) })
      .parse(await context.action("messages", { since: 0 }));
    const listing = messages
      .map((m) => /\b1\. (-?\d+), (-?\d+), (-?\d+) in world:/u.exec(m.text))
      .filter((m) => m !== null);
    if (listing.length !== 1)
      throw new Error(
        `Expected one actual grave listing: ${JSON.stringify(messages)}`,
      );
    const head = z
      .tuple([z.number().int(), z.number().int(), z.number().int()])
      .parse(listing[0]?.slice(1).map(Number));
    if (
      Math.hypot(
        ...head.map((v, i) => v - Math.floor(safe.position[i] ?? Infinity)),
      ) > 2
    )
      throw new Error(
        `The grave did not preserve the player's last safe ground: ${JSON.stringify({ safe: safe.position, head })}`,
      );
    const deadline = performance.now() + 10_000;
    for (;;) {
      const block = await context.block(head);
      if (block.startsWith("minecraft:player_head")) break;
      if (performance.now() > deadline)
        throw new Error(
          "Lava death did not preserve a grave at the last safe position",
        );
      await Bun.sleep(100);
    }
    await context.teleport(context.at(3.5, 0, 0.5), 0, 0);
    await context.lookAt([head[0] + 0.5, head[1] + 0.4, head[2] + 0.5]);
    await context.action("clear-overlays");
    await context.capture(presentation(shots, "grave-lava"));
    await context.use();
    await context.waitFor(
      "grave contents returned",
      (s) =>
        s.connected &&
        s.inventory.some(
          (i) => i.type === "minecraft:diamond" && i.count === 3,
        ),
    );
    if ((await context.block(head)) !== "minecraft:air")
      throw new Error("Collected grave marker remains");
  },
});
