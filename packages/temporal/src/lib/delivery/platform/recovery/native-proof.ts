import { Client, type Connection } from "@temporalio/client";
import { z } from "zod";
import {
  RecordTofuPlanSchema,
  deliveryWorkflowId,
  type CompletePlatformRecovery,
  type PlatformRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import { stepStageKey } from "@shepherdjerred/delivery/model-contract";
import type { V1Job } from "@kubernetes/client-node";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  DeliveryJobReceiptSchema,
  type DeliveryJobRequest,
  type DeliveryJobReceipt,
} from "#shared/delivery-job.ts";
import {
  assertMatchingDeliveryJob,
  deliveryJobManifest,
} from "#lib/delivery/job-manifest.ts";
import type { RecoveryJobReader } from "#lib/delivery/workers/worker-recovery-jobs.ts";
import { platformExecutionJob } from "#lib/delivery/platform/job-request.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { modelRecipe } from "#lib/delivery/model/recipe.ts";
import {
  modelApplyInput,
  modelPlanInput,
  modelTofuJobRequest,
} from "#lib/delivery/model/tofu.ts";
import { recoveryExecutionJob } from "./request.ts";

type NativeProof = Pick<
  CompletePlatformRecovery,
  "sourceWorkflow" | "nativeJobs"
>;

export async function closedPlatformWorkflow(
  connection: Connection,
  id: string,
): Promise<NativeProof["sourceWorkflow"]> {
  const workflowId = deliveryWorkflowId(id);
  const observed = await new Client({ connection, namespace: "prod" }).workflow
    .getHandle(workflowId)
    .describe();
  if (observed.type !== "deliveryDeploymentWorkflow")
    throw new Error("Platform source Workflow identity changed");
  return {
    workflowId,
    status: z
      .enum(["COMPLETED", "FAILED", "CANCELED", "TERMINATED", "TIMED_OUT"])
      .parse(observed.status.name),
  };
}

function terminalStatus(job: V1Job): "Complete" | "Failed" {
  if ((job.status?.active ?? 0) !== 0)
    throw new Error("Platform executor Job remains active");
  const condition = job.status?.conditions?.find(
    (entry) =>
      ["Complete", "Failed"].includes(entry.type) && entry.status === "True",
  );
  return z.enum(["Complete", "Failed"]).parse(condition?.type);
}
function notFound(error: unknown) {
  return z.object({ code: z.literal(404) }).safeParse(error).success;
}
function requireRecordedRequest(
  recorded: DeliveryJobReceipt | undefined,
  expected: V1Job,
  request: DeliveryJobRequest,
) {
  if (recorded === undefined) return;
  if (
    recorded.namespace !== "delivery-platform-jobs" ||
    recorded.name !== expected.metadata?.name ||
    recorded.specFingerprint !==
      expected.metadata.annotations?.[
        "delivery.shepherdjerred.com/fingerprint"
      ] ||
    recorded.requestId !== request.deploymentId
  )
    throw new Error(
      "Recorded platform Job differs from its frozen expected request",
    );
}
async function inspectJob(
  read: RecoveryJobReader,
  request: DeliveryJobRequest,
  recorded?: DeliveryJobReceipt,
) {
  const expected = deliveryJobManifest(request);
  const name = z.string().parse(expected.metadata?.name);
  requireRecordedRequest(recorded, expected, request);
  const pods = await read.pods(name);
  let job: V1Job;
  try {
    job = await read.job(name);
  } catch (error) {
    if (!notFound(error)) throw error;
    if (pods.length > 0)
      throw new Error("Missing native Job still has executor Pods", {
        cause: error,
      });
    // Missing receipts never prove no effects. Target settlement is independently required by the caller.
    return recorded === undefined
      ? undefined
      : {
          ...recorded,
          namespace: "delivery-platform-jobs" as const,
          status: "Deleted" as const,
          podsAbsent: true,
        };
  }
  assertMatchingDeliveryJob(job, expected);
  const receipt = DeliveryJobReceiptSchema.parse({
    namespace: expected.metadata?.namespace,
    name,
    uid: job.metadata?.uid,
    specFingerprint:
      expected.metadata?.annotations?.[
        "delivery.shepherdjerred.com/fingerprint"
      ],
    requestId: request.deploymentId,
  });
  if (
    recorded !== undefined &&
    canonicalJson(recorded) !== canonicalJson(receipt)
  )
    throw new Error(
      "Native platform Job was replaced or its durable receipt changed",
    );
  const status = terminalStatus(job);
  if (
    pods.some(
      (pod) =>
        pod.metadata?.ownerReferences?.some(
          (owner) => owner.kind === "Job" && owner.uid === receipt.uid,
        ) !== true ||
        !["Succeeded", "Failed"].includes(pod.status?.phase ?? ""),
    )
  )
    throw new Error(
      "Native platform executor Pod is live or belongs to another Job incarnation",
    );
  return {
    ...receipt,
    namespace: "delivery-platform-jobs" as const,
    status,
    podsAbsent: pods.length === 0,
  };
}

/**
 * The native Jobs the original deployment could have run: a v1 platform
 * deployment's one Job, or a model tofu recipe's plan Job and, once its
 * plan was saved, its apply Job.
 */
async function originalJobs(
  detail: PlatformRecoveryContext["deployment"],
): Promise<DeliveryJobRequest[]> {
  const recipe = modelRecipe(detail);
  if (recipe?.kind !== "tofu" || detail.deployment.platformSnapshot !== null)
    return [platformExecutionJob(detail)];
  const plan = stepStageKey("step", "plan");
  const requests = [
    modelTofuJobRequest(detail, {
      recipe,
      key: plan,
      kind: "tofu-plan",
      jobInput: modelPlanInput(detail, recipe),
    }),
  ];
  // The apply step runs only after its plan step saved the plan it applies.
  if (
    detail.stages.some(
      (stage) => stage.key === plan && stage.status === "succeeded",
    )
  ) {
    const saved = await deliveryRequest(
      `platform/plans/${encodeURIComponent(detail.deployment.id)}`,
      RecordTofuPlanSchema,
    );
    requests.push(
      modelTofuJobRequest(detail, {
        recipe,
        key: stepStageKey("step", "apply"),
        kind: "tofu-apply",
        jobInput: modelApplyInput(detail, recipe, saved.receipt),
      }),
    );
  }
  return requests;
}

/** One original Job, against the receipt its stage recorded. */
async function inspectOriginal(
  read: RecoveryJobReader,
  detail: PlatformRecoveryContext["deployment"],
  request: DeliveryJobRequest,
) {
  const stage = detail.stages.find((entry) => entry.key === request.stageKey);
  const recorded =
    stage?.message.startsWith("{") === true
      ? DeliveryJobReceiptSchema.parse(JSON.parse(stage.message))
      : undefined;
  if (
    stage !== undefined &&
    stage.operationId !== deliveryJobManifest(request).metadata?.name
  )
    throw new Error("Platform stage does not match the frozen native Job name");
  return await inspectJob(read, request, recorded);
}

/** Reconstructs every execution-controlling spec. A closed Workflow or absent Job alone cannot settle a target. */
export async function provePlatformNativeJobs(
  context: PlatformRecoveryContext,
  read: RecoveryJobReader,
  excludeUID?: string,
): Promise<NativeProof["nativeJobs"]> {
  const result: NativeProof["nativeJobs"] = [];
  for (const request of await originalJobs(context.deployment)) {
    const original = await inspectOriginal(read, context.deployment, request);
    if (original !== undefined) result.push(original);
  }
  for (const intent of [
    ...context.recoveryHistory.filter(
      (entry) => entry.id !== context.intent.id,
    ),
    context.intent,
  ]) {
    for (const [index, native] of intent.nativeReceipts.entries()) {
      if (native.receipt.uid === excludeUID) continue;
      const expected = recoveryExecutionJob(context, {
        intent,
        action: native.action,
        attempt: index + 1,
      });
      const settled = await inspectJob(read, expected, native.receipt);
      if (settled === undefined)
        throw new Error(
          "Recorded recovery Job has no independently observed terminal identity",
        );
      result.push(settled);
    }
  }
  if (result.length > 20)
    throw new Error(
      "Platform native proof exceeds its bounded receipt inventory",
    );
  return result;
}
