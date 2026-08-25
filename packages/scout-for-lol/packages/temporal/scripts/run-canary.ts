import { parseArgs } from "node:util";
import {
  Client,
  Connection,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import { z } from "zod";
import {
  SCOUT_WORKFLOW_NAMES,
  ScoutQueueCanaryProbeResultSchema,
  ScoutStageSchema,
  scoutQueueCanaryWorkflowId,
  scoutTaskQueues,
} from "@scout-for-lol/temporal";

const TemporalTlsSchema = z.enum(["true", "false"]).optional();

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    stage: { type: "string" },
    address: { type: "string", default: "127.0.0.1:7233" },
    namespace: { type: "string", default: "default" },
    "canary-id": { type: "string" },
  },
  strict: true,
});

const options = z
  .strictObject({
    stage: ScoutStageSchema,
    address: z.string().min(1),
    namespace: z.string().min(1),
    "canary-id": z.string().min(1).optional(),
  })
  .parse(values);
const canaryId = options["canary-id"] ?? globalThis.crypto.randomUUID();
const temporalTls = TemporalTlsSchema.parse(process.env["TEMPORAL_TLS"]);
const connection = await Connection.connect({
  address: options.address,
  ...(temporalTls === "true" ? { tls: true } : {}),
});
try {
  const client = new Client({ connection, namespace: options.namespace });
  const handle = await client.workflow.start(SCOUT_WORKFLOW_NAMES.queueCanary, {
    workflowId: scoutQueueCanaryWorkflowId(options.stage, canaryId),
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: scoutTaskQueues(options.stage).workflow,
    args: [{ stage: options.stage, canaryId }],
  });
  const results = z
    .array(ScoutQueueCanaryProbeResultSchema)
    .length(4)
    .parse(await handle.result());
  console.log(
    JSON.stringify(
      {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await connection.close();
}
