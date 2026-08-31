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
const CANARY_TIMEOUT_MS = 60_000;

class CanaryTimeoutError extends Error {
  constructor() {
    super(
      `Scout Temporal queue canary did not complete within ${CANARY_TIMEOUT_MS.toString()}ms`,
    );
    this.name = "CanaryTimeoutError";
  }
}

async function resultWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new CanaryTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    stage: { type: "string" },
    address: { type: "string", default: "127.0.0.1:7233" },
    namespace: { type: "string" },
    "canary-id": { type: "string" },
    "deployment-name": { type: "string" },
    "build-id": { type: "string" },
  },
  strict: true,
});

const options = z
  .strictObject({
    stage: ScoutStageSchema,
    address: z.string().min(1),
    namespace: ScoutStageSchema.optional(),
    "canary-id": z.string().min(1).optional(),
    "deployment-name": z.string().min(1).optional(),
    "build-id": z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
  })
  .parse(values);
const namespace = options.namespace ?? options.stage;
if (namespace !== options.stage) {
  throw new Error(
    `Scout canary namespace ${namespace} must match stage ${options.stage}`,
  );
}
const canaryId = options["canary-id"] ?? globalThis.crypto.randomUUID();
const deploymentName = options["deployment-name"];
const buildId = options["build-id"];
if ((deploymentName === undefined) !== (buildId === undefined)) {
  throw new Error("--deployment-name and --build-id must be supplied together");
}
const temporalTls = TemporalTlsSchema.parse(process.env["TEMPORAL_TLS"]);
const connection = await Connection.connect({
  address: options.address,
  ...(temporalTls === "true" ? { tls: true } : {}),
});
try {
  const client = new Client({ connection, namespace });
  const handle = await client.workflow.start(SCOUT_WORKFLOW_NAMES.queueCanary, {
    workflowId: scoutQueueCanaryWorkflowId(options.stage, canaryId),
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    taskQueue: scoutTaskQueues(options.stage).workflow,
    args: [{ stage: options.stage, canaryId }],
    ...(deploymentName === undefined || buildId === undefined
      ? {}
      : {
          versioningOverride: {
            pinnedTo: { deploymentName, buildId },
          },
        }),
  });
  let rawResults: unknown;
  try {
    rawResults = await resultWithTimeout(handle.result(), CANARY_TIMEOUT_MS);
  } catch (error: unknown) {
    if (error instanceof CanaryTimeoutError) {
      await handle.cancel();
    }
    throw error;
  }
  const results = z
    .array(ScoutQueueCanaryProbeResultSchema)
    .length(4)
    .parse(rawResults);
  console.log(
    JSON.stringify(
      {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
        namespace,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await connection.close();
}
