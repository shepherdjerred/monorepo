import { RegionReadResponseSchema } from "#protocol/bridge.ts";
import type { CaptureTransport } from "./transport.ts";

/** An origin must be restorable in the fixture world before any checkpoint or mutation. */
export function assertOriginWorld(
  player: { world: string; screen: string },
  world: string,
): void {
  if (player.world !== world)
    throw new Error("Player must be in the fixture world before checkpointing");
  if (player.screen !== "")
    throw new Error("Close player menus before checkpointing a scene");
}

/** Verify the body clearance independently of camera rendering and flight permission. */
export async function assertLanding(
  transport: Pick<CaptureTransport, "world">,
  world: string,
  position: [number, number, number],
  airborne = false,
): Promise<void> {
  const [x, y, zz] = position;
  const ground = { x: Math.floor(x), y: Math.floor(y) - 1, z: Math.floor(zz) };
  const area = await transport.world(RegionReadResponseSchema, "region-read", {
    world,
    min: ground,
    max: { ...ground, y: ground.y + 2 },
  });
  const bytes = Buffer.from(area.blocks, "base64");
  if (bytes.length !== 12) throw new Error("Landing region is incomplete");
  const states = [0, 1, 2].map(
    (index) => area.palette[bytes.readUInt32LE(index * 4)],
  );
  const groundState = states[0];
  const harmless =
    /^minecraft:(?:stone|smooth_stone|dirt|grass_block|sand|gravel|deepslate|cobblestone|(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry)_planks|stone_bricks)(?:\[|$)/u;
  if (
    groundState === undefined ||
    (!airborne && !harmless.test(groundState)) ||
    states.slice(1).some((block) => block !== "minecraft:air")
  )
    throw new Error(
      `Destination ${world} ${position.join(",")} does not have verified safe ground and clearance: ${states.join(",")}`,
    );
}
