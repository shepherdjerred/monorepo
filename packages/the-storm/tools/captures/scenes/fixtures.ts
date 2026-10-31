import type { CaptureContext } from "@shepherdjerred/mc-harness/capture/define.ts";

export type Point = [number, number, number];
export const inspectors = ["wilderness", "shops", "banks"];

export async function pad(context: CaptureContext, size: Point): Promise<void> {
  await context.command(`minecraft:gamemode creative ${context.name}`);
  await context.set(context.at(0, 0, 0), context.at(...size), "minecraft:air");
  await context.set(
    context.at(0, -1, 0),
    context.at(size[0], -1, size[2]),
    "minecraft:stone_bricks",
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
