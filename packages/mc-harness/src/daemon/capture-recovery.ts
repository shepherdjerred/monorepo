import { z } from "zod";
import type { CaptureRun } from "#src/capture/model.ts";
import type { ClientState } from "#protocol/client.ts";
import type { CaptureBoundedActionSchema } from "#protocol/capture.ts";
import { DaemonError } from "./http.ts";

type RecoveryRun = Pick<
  CaptureRun,
  "id" | "target" | "name" | "state" | "box" | "cleanup"
>;

const refuse = () =>
  new DaemonError("Interaction does not match saved live cleanup", 409);

/** A durable recovery receipt permits only a stationary sign punch or holding sneak. */
export function recoveryInteraction(
  run: RecoveryRun,
  client: string,
  operation: z.infer<typeof CaptureBoundedActionSchema>,
  state: ClientState,
): Record<string, unknown> {
  if (
    !state.connected ||
    run.target !== "live" ||
    run.name !== client ||
    run.id !== operation.recovery ||
    !["cleanup", "needs-recovery"].includes(run.state) ||
    JSON.stringify(run.box) !== JSON.stringify(operation.box) ||
    state.heldInputs.some((button) => button !== "sneak")
  )
    throw refuse();
  const hit = z
    .tuple([z.number().int(), z.number().int(), z.number().int()])
    .safeParse(state.target["position"]);
  if (state.target.kind !== "block" || !hit.success) throw refuse();
  const cleanup = run.cleanup.find(
    (entry) =>
      entry.kind === "break" &&
      entry.position.every((value, index) => value === hit.data[index]) &&
      entry.standing.every(
        (value, index) =>
          Math.abs(value - (state.position[index] ?? Infinity)) < 0.3,
      ),
  );
  if (cleanup === undefined) throw refuse();
  if (operation.action === "attack") {
    z.strictObject({}).parse(operation.arguments);
    return { expectedBlock: hit.data, expectedWorld: state.world };
  }
  if (operation.action === "input")
    return z
      .strictObject({
        buttons: z.tuple([z.literal("sneak")]),
        ticks: z.number().int().min(1).max(40),
      })
      .parse(operation.arguments);
  throw refuse();
}
