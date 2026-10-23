import { z } from "zod";
import {
  BatchV1Api,
  CoreV1Api,
  type KubeConfig,
  type V1Job,
  type V1Pod,
} from "@kubernetes/client-node";
import type {
  WorkerRecoveryContext,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import {
  DeliveryJobReceiptSchema,
  DeliveryJobRequestSchema,
} from "#shared/delivery-job.ts";
import {
  assertMatchingDeliveryJob,
  deliveryJobManifest,
} from "#lib/delivery/job-manifest.ts";
import { workerRunnerImage } from "./worker-plan.ts";

export type RecoveryJobReader = {
  job: (name: string) => Promise<V1Job>;
  pods: (name: string) => Promise<V1Pod[]>;
};
export function recoveryJobReader(
  config: KubeConfig,
  namespace:
    "delivery-worker-jobs" | "delivery-platform-jobs" = "delivery-worker-jobs",
): RecoveryJobReader {
  const batch = config.makeApiClient(BatchV1Api),
    core = config.makeApiClient(CoreV1Api);
  return {
    job: async (name) => await batch.readNamespacedJob({ namespace, name }),
    pods: async (name) => {
      const result = await core.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${name}`,
      });
      return result.items;
    },
  };
}

type Stage = WorkerRecoveryContext["deployment"]["stages"][number];
function requireRecordedReceipt(
  stage: Stage,
  deploymentId: string,
  uid: string,
  fingerprint: string,
) {
  if (!stage.message.startsWith("{")) return;
  const recorded = DeliveryJobReceiptSchema.parse(JSON.parse(stage.message));
  if (
    recorded.name !== stage.operationId ||
    recorded.uid !== uid ||
    recorded.specFingerprint !== fingerprint ||
    recorded.requestId !== deploymentId
  )
    throw new Error(
      "Recorded Job incarnation differs from native recovery observation",
    );
}
function requireOwnedJob(
  actual: V1Job,
  stage: Stage,
  deploymentId: string,
  runnerImage: string,
) {
  const encoded = actual.spec?.template.spec?.containers[0]?.env?.find(
    (entry) => entry.name === "DELIVERY_JOB_REQUEST",
  )?.value;
  const input = DeliveryJobRequestSchema.parse(
    JSON.parse(z.string().parse(encoded)),
  );
  const expected = deliveryJobManifest(input);
  if (
    !input.recipe.startsWith("worker-") ||
    input.deploymentId !== deploymentId ||
    input.stageKey !== stage.key ||
    input.runnerImage !== runnerImage ||
    expected.metadata?.name !== stage.operationId
  )
    throw new Error(
      "Recovery Job does not belong to the exact frozen worker stage",
    );
  assertMatchingDeliveryJob(actual, expected);
  const uid = z.string().min(1).parse(actual.metadata?.uid);
  const fingerprint = z
    .string()
    .parse(
      expected.metadata.annotations?.[
        "delivery.shepherdjerred.com/fingerprint"
      ],
    );
  requireRecordedReceipt(stage, deploymentId, uid, fingerprint);
  return { uid, fingerprint };
}
function requireTerminalJob(actual: V1Job) {
  if (
    (actual.status?.active ?? 0) !== 0 ||
    actual.status?.conditions?.some(
      (condition) =>
        ["Complete", "Failed"].includes(condition.type) &&
        condition.status === "True",
    ) !== true
  )
    throw new Error("Recovery Job is not independently terminal");
}

function uncreatedProvenance(stage: Stage, context: WorkerRecoveryContext) {
  return (
    stage.key === "worker-image-provenance" &&
    stage.status === "running" &&
    stage.deploymentId === context.deployment.deployment.id &&
    /^delivery-[a-f0-9]{40}$/u.test(stage.operationId) &&
    stage.message === "Waiting for an identity-bound revision-pinned Job" &&
    !context.deployment.evidence.some(
      (entry) =>
        entry.operationId === stage.operationId ||
        entry.summary.includes(stage.operationId),
    )
  );
}

async function readRecoveryJob(
  stage: Stage,
  context: WorkerRecoveryContext,
  read: RecoveryJobReader,
) {
  try {
    return await read.job(stage.operationId);
  } catch (error) {
    if (
      !z.object({ code: z.literal(404) }).safeParse(error).success ||
      !uncreatedProvenance(stage, context)
    )
      throw error;
    const pods = await read.pods(stage.operationId);
    if (pods.length > 0) throw error;
    return;
  }
}

/** Readback never creates, restarts or deletes a Job, even when its create response was lost. */
export async function proveTerminalWorkerJobs(
  context: WorkerRecoveryContext,
  read: RecoveryJobReader,
): Promise<EvidenceInput[]> {
  const detail = context.deployment;
  // The v1 pipeline's pinned runner, or the one admission froze for a model recipe.
  const runnerImage = workerRunnerImage(detail);
  const evidence: EvidenceInput[] = [];
  for (const stage of detail.stages.filter((entry) =>
    /^worker-(?:image-provenance|preflight|start|advance-50|advance-100|promote|verify)$/u.test(
      entry.key,
    ),
  )) {
    const actual = await readRecoveryJob(stage, context, read);
    if (actual === undefined) {
      evidence.push({
        kind: "reconciliation",
        operationId: stage.operationId,
        summary: `Read-only provenance Job delivery-worker-jobs/${stage.operationId} was not created: authenticated GET 404, no recorded native receipt and no executor Pods`,
      });
      continue;
    }
    const { uid, fingerprint } = requireOwnedJob(
      actual,
      stage,
      detail.deployment.id,
      runnerImage,
    );
    const recorded = detail.evidence.filter((entry) =>
      entry.summary.includes(`fingerprint ${fingerprint}`),
    );
    if (recorded.some((entry) => entry.operationId !== uid))
      throw new Error(
        "Recorded Job incarnation differs from native recovery observation",
      );
    requireTerminalJob(actual);
    const pods = await read.pods(stage.operationId);
    if (
      pods.some(
        (pod) =>
          pod.metadata?.ownerReferences?.some(
            (owner) => owner.kind === "Job" && owner.uid === uid,
          ) !== true,
      )
    )
      throw new Error("Recovery found a replaced or unrelated executor Pod");
    if (
      pods.some(
        (pod) => !["Succeeded", "Failed"].includes(pod.status?.phase ?? ""),
      )
    )
      throw new Error(
        "Recovery Job still has a live or terminating executor Pod",
      );
    evidence.push({
      kind: "reconciliation",
      operationId: uid,
      summary: `Terminal fixed worker Job delivery-worker-jobs/${stage.operationId}, exact UID ${uid}, fingerprint ${fingerprint}`,
    });
  }
  return evidence;
}
