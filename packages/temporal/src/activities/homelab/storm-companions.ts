import { z } from "zod";
import { kubectl, run, type Command } from "./mining-reset-kubectl.ts";

const PodSchema = z.object({
  status: z
    .object({
      phase: z.string(),
      containerStatuses: z
        .array(z.object({ name: z.string(), ready: z.boolean() }))
        .optional(),
    })
    .optional(),
});

/** Read-only pod inspection followed by an idempotent reconciliation; never wakes Minecraft. */
export async function reconcileStormCompanions(
  command: Command = kubectl,
): Promise<"sleeping" | "reconciled"> {
  const result = await command([
    "get",
    "pod",
    "minecraft-tsmc-0",
    "-n",
    "minecraft-tsmc",
    "-o",
    "json",
    "--ignore-not-found",
  ]);
  if (result.exitCode !== 0)
    throw new Error(
      "cannot inspect The Storm pod for companion reconciliation",
    );
  if (result.stdout.trim() === "") return "sleeping";
  const pod = PodSchema.parse(JSON.parse(result.stdout));
  if (
    pod.status?.phase !== "Running" ||
    pod.status.containerStatuses?.some(
      (container) => container.name === "minecraft" && container.ready,
    ) !== true
  )
    return "sleeping";
  const reply = await run(command, [
    "exec",
    "-n",
    "minecraft-tsmc",
    "minecraft-tsmc-0",
    "-c",
    "minecraft",
    "--",
    "rcon-cli",
    "companion reconcile",
  ]);
  if (!reply.includes("Companion reconciliation requested"))
    throw new Error("The Storm did not acknowledge companion reconciliation");
  return "reconciled";
}
export const stormCompanionActivities = {
  reconcileStormCompanions: () => reconcileStormCompanions(),
};
export type StormCompanionActivities = typeof stormCompanionActivities;
