import { Client, Connection } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { z } from "zod";
import {
  controlPlaneHistory,
  controlPlaneHistoryFingerprint,
} from "#lib/delivery/platform/control-plane-history.ts";

const [deploymentId, workflowId, rawRunId] = process.argv.slice(2);
const execution = {
  deploymentId: z.string().min(1).parse(deploymentId),
  workflowId: z.string().min(1).parse(workflowId),
  runId: z.uuid().parse(rawRunId),
};
const connection = await Connection.connect({
  address: z.string().min(1).parse(globalThis.process.env["TEMPORAL_ADDRESS"]),
});
try {
  const client = new Client({ connection, namespace: "prod" });
  const history = await controlPlaneHistory(client, execution);
  await Worker.runReplayHistory(
    {
      workflowsPath: new URL("../../src/workflows/delivery.ts", import.meta.url)
        .pathname,
    },
    history,
    execution.workflowId,
  );
  process.stdout.write(
    `DELIVERY_CP_REPLAY_V1=${JSON.stringify({ runId: execution.runId, historySha256: controlPlaneHistoryFingerprint(history) })}\n`,
  );
} finally {
  await connection.close();
}
