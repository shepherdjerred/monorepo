import { Context } from "@temporalio/activity";
import { z } from "zod";
import protocol from "@shepherdjerred/the-storm/server/owned/plugins/TheStorm/plot-reconcile.json" with { type: "json" };
import { kubectl, run, type Command } from "./mining-reset-kubectl.ts";

const State = z.enum(["RUNNING", "COMPLETE", "BUSY", "FAILED", "UNKNOWN"]);
const Protocol = z
  .object({
    version: z.literal(1),
    prefix: z.literal("PLOT_RECONCILE"),
    states: z
      .array(State)
      .length(5)
      .refine((states) => new Set(states).size === 5),
  })
  .strict()
  .parse(protocol);
const Operation = z.uuid();
const Server = z.object({
  metadata: z.object({
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.object({ replicas: z.number().int().nonnegative() }),
  status: z
    .object({ readyReplicas: z.number().int().nonnegative().optional() })
    .optional(),
});

export function plotReconcileState(
  response: string,
  operation: string,
): z.infer<typeof State> {
  const fields = response.trim().split(/\s+/);
  if (
    fields.length !== 3 ||
    fields[0] !== Protocol.prefix ||
    fields[1] !== Operation.parse(operation)
  ) {
    throw new Error(
      "The Storm returned a mismatched plot reconciliation response",
    );
  }
  return State.parse(fields[2]);
}

type Dependencies = {
  readonly command: Command;
  readonly heartbeat: (phase: string) => void;
  readonly sleep: (milliseconds: number) => Promise<void>;
};
export type PlotReconcileResult = "completed" | "sleeping" | "busy";

export async function reconcileStormPlotsWithDependencies(
  operationInput: string,
  dependencies: Dependencies,
): Promise<PlotReconcileResult> {
  const operation = Operation.parse(operationInput);
  const server = Server.parse(
    JSON.parse(
      await run(dependencies.command, [
        "--request-timeout=15s",
        "-n",
        "minecraft-tsmc",
        "get",
        "statefulset",
        "minecraft-tsmc",
        "-o",
        "json",
      ]),
    ),
  );
  if (server.spec.replicas === 0 || (server.status?.readyReplicas ?? 0) === 0) {
    return "sleeping";
  }
  if (
    server.metadata.annotations?.["sjer.red/mining-reset-lock"] !== undefined
  ) {
    return "busy";
  }
  let command = `plot admin reconcile ${operation}`;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    dependencies.heartbeat("plot-reconciliation");
    const response = await run(dependencies.command, [
      "--request-timeout=15s",
      "-n",
      "minecraft-tsmc",
      "exec",
      "minecraft-tsmc-0",
      "-c",
      "minecraft-tsmc",
      "--",
      "rcon-cli",
      command,
    ]);
    const state = plotReconcileState(response, operation);
    if (state === "COMPLETE") return "completed";
    if (state === "BUSY") return "busy";
    if (state === "FAILED")
      throw new Error(
        "The Storm plot recovery failed; the plugin retains its protected journals",
      );
    command =
      state === "UNKNOWN"
        ? `plot admin reconcile ${operation}`
        : `plot admin status ${operation}`;
    await dependencies.sleep(1000);
  }
  throw new Error(
    "The Storm plot recovery exceeded its four-minute polling window; journals remain resumable",
  );
}

export const stormPlotActivities = {
  async reconcileStormPlots(operation: string): Promise<PlotReconcileResult> {
    return reconcileStormPlotsWithDependencies(operation, {
      command: kubectl,
      heartbeat: (phase) => {
        Context.current().heartbeat({ operation, phase });
      },
      sleep: Bun.sleep,
    });
  },
};
export type StormPlotActivities = typeof stormPlotActivities;
