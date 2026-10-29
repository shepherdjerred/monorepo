import { z } from "zod";
import type { CaptureContext } from "./define.ts";

/** Updating yaw does not immediately update Minecraft's rendered raycast. */
export function createLookAt(
  status: CaptureContext["status"],
  native: (action: string, args: Record<string, unknown>) => Promise<unknown>,
  waitFor: CaptureContext["waitFor"],
): CaptureContext["lookAt"] {
  return async (position) => {
    const state = await status();
    if (!state.connected) throw new Error("Client disconnected");
    const before = z.object({ renderedFrames: z.number() }).parse(state);
    const dx = position[0] - state.position[0],
      dy = position[1] - state.position[1] - 1.62,
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
