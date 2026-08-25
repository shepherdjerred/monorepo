import path from "node:path";
import { Client, Connection } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { z } from "zod";

const WorkflowIdSchema = z.string().regex(/^scout-(?:beta|prod)-[\w.:-]+$/u);
const TlsSchema = z.enum(["true", "false"]).optional();

async function main(): Promise<void> {
  const workflowIds = process.argv
    .slice(2)
    .map((value) => WorkflowIdSchema.parse(value));
  if (workflowIds.length === 0) {
    throw new Error("Pass at least one beta or production Scout Workflow ID");
  }
  const address = process.env["TEMPORAL_ADDRESS"];
  if (address === undefined) {
    throw new Error("TEMPORAL_ADDRESS is required for live history replay");
  }
  const tls = TlsSchema.parse(process.env["TEMPORAL_TLS"]);
  const connection = await Connection.connect({
    address,
    ...(tls === "true" ? { tls: true } : {}),
  });
  try {
    const client = new Client({
      connection,
      namespace: process.env["TEMPORAL_NAMESPACE"] ?? "default",
    });
    const workflowsPath = path.resolve(
      import.meta.dirname,
      "../src/workflows/index.ts",
    );
    for (const workflowId of workflowIds) {
      const history = await client.workflow
        .getHandle(workflowId)
        .fetchHistory();
      await Worker.runReplayHistory({ workflowsPath }, history, workflowId);
      console.warn(`Replayed ${workflowId}`);
    }
  } finally {
    await connection.close();
  }
}

await main();
