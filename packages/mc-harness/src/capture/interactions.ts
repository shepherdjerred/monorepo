import type { CaptureContext } from "./define.ts";
import { z } from "zod";

type Action = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** Own the held input through pose verification, including native rejection. */
export function createInteractions(controls: {
  mark: () => Promise<void>;
  bounded: Action;
  native: Action;
  waitFor: CaptureContext["waitFor"];
  status: CaptureContext["status"];
  lookAt: CaptureContext["lookAt"];
}) {
  return async (action: "use" | "attack", sneak = false): Promise<void> => {
    await controls.mark();
    if (!sneak) {
      await controls.bounded(action);
      return;
    }
    let inputError: Error | undefined;
    const aimed = await controls.status();
    if (!aimed.connected)
      throw new Error("Client disconnected before interaction");
    const hit = z
      .tuple([z.number(), z.number(), z.number()])
      .parse(aimed.target["hit"]);
    const held = (async () => {
      try {
        await controls.bounded("input", { buttons: ["sneak"], ticks: 40 });
      } catch (error) {
        if (error instanceof Error && error.message.endsWith("Input cancelled"))
          return;
        inputError = error instanceof Error ? error : new Error(String(error));
      }
    })();
    try {
      await controls.waitFor("sneak held", (state) => {
        if (inputError !== undefined) throw inputError;
        return (
          state.connected &&
          state.heldInputs.includes("sneak") &&
          state["crouching"] === true
        );
      });
      await controls.lookAt(hit);
      await controls.bounded(action);
    } finally {
      await controls.native("release-inputs");
      await held;
    }
    if (inputError !== undefined) throw inputError;
  };
}
