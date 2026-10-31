import { z } from "zod";
import type { CaptureContext } from "./define.ts";

/** Wall signs occupy the supporting side of their cell, rather than its center. */
export function fixtureAim(
  position: [number, number, number],
  block: string,
): [number, number, number] {
  const [x, y, zz] = position;
  if (!block.includes("_wall_sign[")) return [x + 0.5, y + 0.5, zz + 0.5];
  const facing = /facing=(north|south|east|west)/u.exec(block)?.[1];
  const offsets: Record<string, [number, number, number]> = {
    north: [0.5, 0.5, 0.9375],
    south: [0.5, 0.5, 0.0625],
    east: [0.0625, 0.5, 0.5],
    west: [0.9375, 0.5, 0.5],
  };
  const offset = facing === undefined ? undefined : offsets[facing];
  if (offset === undefined) throw new Error("Wall sign has no known facing");
  return [x + offset[0], y + offset[1], zz + offset[2]];
}

/** Updating yaw does not immediately update Minecraft's rendered raycast. */
export function createLookAt(
  status: CaptureContext["status"],
  native: (action: string, args: Record<string, unknown>) => Promise<unknown>,
  waitFor: CaptureContext["waitFor"],
): CaptureContext["lookAt"] {
  return async (position) => {
    const state = await status();
    if (!state.connected) throw new Error("Client disconnected");
    const before = z
      .object({ renderedFrames: z.number(), eyeHeight: z.number().positive() })
      .parse(state);
    const dx = position[0] - state.position[0],
      dy = position[1] - state.position[1] - before.eyeHeight,
      dz = position[2] - state.position[2];
    await native("look", {
      yaw: (Math.atan2(-dx, dz) * 180) / Math.PI,
      pitch: (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
    });
    await waitFor(
      "freshly rendered camera aim",
      (current) =>
        current.connected &&
        typeof current["renderedFrames"] === "number" &&
        current["renderedFrames"] >= before.renderedFrames + 3,
    );
  };
}
