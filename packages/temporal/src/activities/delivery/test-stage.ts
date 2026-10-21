import { z } from "zod";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { runDeliveryJob } from "#lib/delivery/job.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import {
  TestStageInputSchema,
  TestStageResultSchema,
  type TestStageResult,
} from "#lib/delivery/test-stage.ts";
import type {
  DeliveryJobReceipt,
  DeliveryJobRequest,
} from "#shared/delivery-job.ts";

/** Evidence shape accepted by the API's `test` evidence kind. */
export type TestStageEvidence = {
  kind: "test";
  summary: string;
  operationId: string;
};

export type TestStageRequest = {
  stageKey: string;
  suite: string;
  workspace: string;
  sourceRevision: string;
  runnerImage: string;
};

/**
 * Runs the named suite as a Kueue Job on the CI node at the frozen source
 * revision and returns its bounded JSON result as `test` evidence (V5). The
 * stage is recorded `running` with the Job identity before the Job can finish.
 */
export async function runDeliveryTestStage(
  deploymentId: string,
  request: TestStageRequest,
  runJob: typeof runDeliveryJob = runDeliveryJob,
): Promise<{ evidence: TestStageEvidence; result: TestStageResult }> {
  const input = TestStageInputSchema.parse({
    suite: request.suite,
    workspace: request.workspace,
  });
  const job: DeliveryJobRequest = {
    deploymentId,
    stageKey: request.stageKey,
    recipe: "test",
    runnerImage: request.runnerImage,
    sourceRevision: request.sourceRevision,
    input,
  };
  const operationId = z.string().parse(deliveryJobManifest(job).metadata?.name);
  const base = `deployments/${encodeURIComponent(deploymentId)}`;
  let receipt: DeliveryJobReceipt | undefined;
  const raw = await runJob(job, async (native) => {
    receipt = native;
    await deliveryRequest(`${base}/stages`, z.unknown(), {
      key: request.stageKey,
      status: "running",
      operationId,
      message: JSON.stringify(native),
      evidence: [],
    });
  });
  if (receipt === undefined)
    throw new Error("Test stage Job has no persisted native receipt");
  const result = TestStageResultSchema.parse(raw);
  if (result.suite !== input.suite || result.workspace !== input.workspace)
    throw new Error("Test stage result names another suite or workspace");
  return {
    result,
    evidence: {
      kind: "test",
      summary: JSON.stringify(result),
      operationId: receipt.uid,
    },
  };
}
