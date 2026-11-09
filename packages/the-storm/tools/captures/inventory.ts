import { z } from "zod";
import type { CaptureContext } from "@shepherdjerred/mc-harness/capture/define.ts";

const View = z.object({
  containerId: z.number(),
  stateId: z.number(),
  slots: z.array(z.object({ slot: z.number(), type: z.string() })),
});
/** Reinspect only the native protocol's explicit stale-container rejection. */
export async function hoverItem(
  context: CaptureContext,
  type: string,
  screen = "Crafting",
) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const state = await context.status();
    if (!state.connected || state.screen !== screen)
      throw new Error(
        `Item tooltip requires the expected open container: ${screen}`,
      );
    const view = View.parse(state);
    const item = view.slots.find((i) => i.type === type);
    if (!item) throw new Error(`Missing tooltip item ${type}`);
    try {
      await context.action("hover-slot", {
        containerId: view.containerId,
        stateId: view.stateId,
        slot: item.slot,
      });
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.endsWith("Container changed; inspect it again")
      )
        throw error;
    }
  }
  throw new Error("Inventory kept changing before the tooltip could be shown");
}
