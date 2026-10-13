import { Client, Connection, type ConnectionOptions } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { z } from "zod";

export const TemporalReplayNamespaceSchema = z.enum(["dev", "beta", "prod"]);

export type TemporalReplayTarget =
  string | { readonly workflowId: string; readonly runId: string };

/** Keep distinct executions of a continued Workflow; never collapse by ID. */
export function parseTemporalReplayTargets(
  args: readonly string[],
  validateWorkflowId: (value: string) => string,
): TemporalReplayTarget[] {
  const targets: TemporalReplayTarget[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === undefined) throw new Error("Missing replay target");
    if (value !== "--run") {
      targets.push(validateWorkflowId(value));
      continue;
    }
    const workflowId = args[++index];
    const runId = args[++index];
    if (workflowId === undefined || runId === undefined)
      throw new Error("--run requires a Workflow ID and run UUID");
    targets.push({
      workflowId: validateWorkflowId(workflowId),
      runId: z.uuid().parse(runId),
    });
  }
  return targets;
}

export function temporalOperatorConnectionOptions(
  environment: Readonly<Record<string, string | undefined>>,
): ConnectionOptions {
  const address = environment["TEMPORAL_ADDRESS"];
  if (address === undefined || address.length === 0) {
    throw new Error("TEMPORAL_ADDRESS is required for live history replay");
  }
  const tls = z
    .enum(["true", "false"])
    .optional()
    .parse(environment["TEMPORAL_TLS"]);
  const apiKey = environment["TEMPORAL_API_KEY"];
  if (apiKey !== undefined && (tls !== "true" || apiKey.length === 0)) {
    throw new Error("A nonempty TEMPORAL_API_KEY requires TEMPORAL_TLS=true");
  }
  return {
    address,
    ...(tls === "true" ? { tls: true } : {}),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

export async function replayTemporalHistories(input: {
  workflowIds: readonly TemporalReplayTarget[];
  emptyMessage: string;
  workflowsPath: string;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  if (input.workflowIds.length === 0) {
    throw new Error(input.emptyMessage);
  }
  const environment = input.environment ?? Bun.env;
  const namespace = TemporalReplayNamespaceSchema.parse(
    environment["TEMPORAL_NAMESPACE"],
  );
  const connection = await Connection.connect(
    temporalOperatorConnectionOptions(environment),
  );
  try {
    const client = new Client({
      connection,
      namespace,
    });
    for (const target of input.workflowIds) {
      const { workflowId, runId } =
        typeof target === "string"
          ? { workflowId: target, runId: undefined }
          : target;
      const history = await client.workflow
        .getHandle(workflowId, runId)
        .fetchHistory();
      await Worker.runReplayHistory(
        { workflowsPath: input.workflowsPath },
        history,
        workflowId,
      );
      console.warn(
        `Replayed ${workflowId}${runId === undefined ? "" : `/${runId}`}`,
      );
    }
  } finally {
    await connection.close();
  }
}
