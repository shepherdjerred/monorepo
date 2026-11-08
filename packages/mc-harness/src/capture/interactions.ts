import type { CaptureContext } from "./define.ts";
import { z } from "zod";
import { ClientMoveRequestSchema } from "#protocol/client.ts";

type Action = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** Movement can face open air; presses that can change the world stay bounded. */
export function createSceneActions(
  native: Action,
  bounded: Action,
): CaptureContext["action"] {
  return async (action, args = {}) => {
    if (action === "move") {
      const input = ClientMoveRequestSchema.parse(args);
      return input.buttons.some(
        (button) => button === "use" || button === "attack",
      )
        ? bounded("input", input)
        : native("move", input);
    }
    return [
      "use",
      "attack",
      "click",
      "sign-write",
      "screen-activate",
      "screen-type",
    ].includes(action)
      ? bounded(action, args)
      : native(action, args);
  };
}

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
