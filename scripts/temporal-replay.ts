import { Client, Connection } from "@temporalio/client";
import { Worker } from "@temporalio/worker";

export async function replayTemporalHistories(input: {
  workflowIds: readonly string[];
  emptyMessage: string;
  workflowsPath: string;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  if (input.workflowIds.length === 0) {
    throw new Error(input.emptyMessage);
  }
  const environment = input.environment ?? Bun.env;
  const address = environment["TEMPORAL_ADDRESS"];
  if (address === undefined) {
    throw new Error("TEMPORAL_ADDRESS is required for live history replay");
  }
  const tls = environment["TEMPORAL_TLS"];
  if (tls !== undefined && tls !== "true" && tls !== "false") {
    throw new Error(`TEMPORAL_TLS must be true or false, got ${tls}`);
  }
  const connection = await Connection.connect({
    address,
    ...(tls === "true" ? { tls: true } : {}),
  });
  try {
    const client = new Client({
      connection,
      namespace: environment["TEMPORAL_NAMESPACE"] ?? "default",
    });
    for (const workflowId of input.workflowIds) {
      const history = await client.workflow
        .getHandle(workflowId)
        .fetchHistory();
      await Worker.runReplayHistory(
        { workflowsPath: input.workflowsPath },
        history,
        workflowId,
      );
      console.warn(`Replayed ${workflowId}`);
    }
  } finally {
    await connection.close();
  }
}
