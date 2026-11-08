import type {
  CaptureContext,
  CaptureScene,
} from "@shepherdjerred/mc-harness/capture/define.ts";
import { z } from "zod";

export type Point = [number, number, number];
export const inspectors = ["wilderness", "shops", "banks"];
export const chatVenue: Pick<
  CaptureScene,
  "bounds" | "staging" | "inspectors"
> = {
  bounds: { min: [0, -1, 0], max: [12, 4, 12] },
  staging: [20.5, 2, -29.5],
  inspectors,
};

/** Capture a confirmed command reply with the chat open, then return to gameplay. */
export async function commandShot(
  context: CaptureContext,
  [name, command, expected, caption]: readonly [string, string, string, string],
): Promise<void> {
  await context.action("clear-overlays");
  await context.playerCommand(command, expected);
  await context.action("chat-open");
  await context.capture({
    schema: 1,
    name,
    alt: caption,
    caption,
    annotations: [],
  });
  await context.action("close");
}
const MessagesSchema = z.object({
  cursor: z.number(),
  messages: z.array(z.object({ text: z.string() })),
});

/** Retry only the structure's explicit cooldown reply; verify the actual server block. */
export async function useUntilBlock(
  context: CaptureContext,
  position: Point,
  matches: (block: string) => boolean,
): Promise<void> {
  const initial = MessagesSchema.parse(
    await context.action("messages", { since: 0 }),
  );
  let cursor = initial.cursor,
    click = true,
    observed = "";
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (click) {
      await context.use();
    }
    observed = await context.block(context.at(...position));
    if (matches(observed)) return;
    const recent = MessagesSchema.parse(
      await context.action("messages", { since: cursor }),
    );
    cursor = recent.cursor;
    click = recent.messages.some((message) =>
      message.text.includes("It is still moving; try again in a moment."),
    );
    await Bun.sleep(50);
  }
  throw new Error(
    `Fixture transition at ${position.join(",")} stopped at ${observed}`,
  );
}

export async function pad(context: CaptureContext, size: Point): Promise<void> {
  await context.command(`minecraft:gamemode creative ${context.name}`);
  await context.set(context.at(0, 0, 0), context.at(...size), "minecraft:air");
  await context.set(
    context.at(0, -1, 0),
    context.at(size[0], -1, size[2]),
    "minecraft:grass_block",
  );
}

/** World-only signs are restored with the scene snapshot; banks/shops need resource cleanup. */
export async function wallSign(
  context: CaptureContext,
  options: {
    position: Point;
    standing: Point;
    lines: [string, string, string, string];
  },
): Promise<void> {
  const [x, y, zz] = options.position;
  await context.teleport(context.at(...options.standing), 0, 0);
  await context.command(
    `minecraft:item replace entity ${context.name} hotbar.0 with minecraft:oak_sign`,
  );
  await context.action("hotbar", { slot: 0 });
  await context.lookAt(context.at(x + 0.5, y + 0.5, zz + 1));
  await context.use(true);
  await context.sign(options.lines);
}

export async function camera(
  context: CaptureContext,
  position: Point,
  look: Point,
): Promise<void> {
  await context.command(`minecraft:gamemode survival ${context.name}`);
  await context.action("hotbar", { slot: 7 });
  await context.teleport(context.at(...position), 0, 0);
  await context.lookAt(context.at(...look));
  await context.action("clear-overlays");
}

/** The real riverside overlook faces spawn town instead of an empty staging pad. */
export async function chatCamera(context: CaptureContext): Promise<void> {
  await camera(context, [0.5, 0, 0.5], [-63, 6, -66]);
}

export async function waitBlock(
  context: CaptureContext,
  position: Point,
  matches: (block: string) => boolean,
): Promise<void> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (matches(await context.block(context.at(...position)))) return;
    await Bun.sleep(50);
  }
  throw new Error(
    `Fixture block at ${position.join(",")} did not reach its expected state`,
  );
}
