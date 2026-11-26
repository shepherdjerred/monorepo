import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type { DeploymentDetail, EvidenceInput } from "#shared/contract.ts";
import { KUBERNETES_OBJECT_BOUND } from "#infrastructure/kubernetes/projected-identity.ts";
import {
  listKubernetes,
  projectedReader,
  type KubernetesRead,
} from "#infrastructure/kubernetes/projected-reader.ts";
import type { SyncTarget } from "./unsynced.ts";

export const TEST_STAGE_KEY_PATTERN = /^(?:sub\d+-)?test-[a-z0-9-]{1,63}$/u;

/** The projected `delivery-worker-jobs-reader` settlement identity for `test-*` stages. */
export function createWorkerJobsReader(read?: KubernetesRead): KubernetesRead {
  return projectedReader(
    {
      name: "delivery-worker-jobs-reader",
      directory: "/var/run/delivery-worker-jobs-reader",
    },
    read,
    { bound: KUBERNETES_OBJECT_BOUND },
  );
}

const RecordedTestReceiptSchema = z.object({
  namespace: z.literal("delivery-worker-jobs"),
  name: z.string().min(1),
  uid: z.string().min(1),
  specFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  requestId: z.string().min(1),
});

const TestStageJobSchema = z.object({
  metadata: z.object({
    name: z.string().min(1),
    namespace: z.literal("delivery-worker-jobs"),
    uid: z.string().min(1),
    annotations: z.record(z.string(), z.string()),
  }),
  status: z
    .object({
      active: z.number().int().nonnegative().optional(),
      conditions: z
        .array(z.object({ type: z.string(), status: z.string() }))
        .optional(),
    })
    .optional(),
});

const TestStagePodSchema = z.object({
  metadata: z
    .object({
      ownerReferences: z
        .array(z.object({ kind: z.string(), uid: z.string() }))
        .optional(),
    })
    .optional(),
  status: z.object({ phase: z.string().optional() }).optional(),
});

function verifyRecordedReceipt(
  stage: DeploymentDetail["stages"][number],
  uid: string,
  fingerprintValue: string,
  deploymentId: string,
) {
  if (!stage.message.startsWith("{")) return;
  let rawReceipt: unknown;
  try {
    rawReceipt = JSON.parse(stage.message);
  } catch {
    rawReceipt = null;
  }
  const receipt = RecordedTestReceiptSchema.safeParse(rawReceipt);
  if (
    !receipt.success ||
    receipt.data.name !== stage.operationId ||
    receipt.data.uid !== uid ||
    receipt.data.specFingerprint !== fingerprintValue ||
    receipt.data.requestId !== deploymentId
  )
    throw new DeliveryError(
      "CONFLICT",
      `Recorded test stage receipt for ${stage.key} differs from native observation; keep target ownership`,
    );
}

function verifyOwnedTestJob(
  rawJob: unknown,
  stage: DeploymentDetail["stages"][number],
  deploymentId: string,
) {
  const parsed = TestStageJobSchema.safeParse(rawJob);
  if (!parsed.success)
    throw new DeliveryError(
      "CONFLICT",
      `Test stage Job delivery-worker-jobs/${stage.operationId} does not match the frozen deployment stage; keep target ownership`,
    );
  const job = parsed.data;
  const fingerprintValue =
    job.metadata.annotations["delivery.shepherdjerred.com/fingerprint"];
  if (
    fingerprintValue === undefined ||
    job.metadata.name !== stage.operationId ||
    job.metadata.annotations["delivery.shepherdjerred.com/request"] !==
      deploymentId ||
    !/^[a-f0-9]{64}$/u.test(fingerprintValue)
  )
    throw new DeliveryError(
      "CONFLICT",
      `Test stage Job delivery-worker-jobs/${stage.operationId} does not match the frozen deployment stage; keep target ownership`,
    );
  verifyRecordedReceipt(
    stage,
    job.metadata.uid,
    fingerprintValue,
    deploymentId,
  );
  const terminal =
    (job.status?.active ?? 0) === 0 &&
    job.status?.conditions?.some(
      (c) =>
        (c.type === "Complete" || c.type === "Failed") && c.status === "True",
    ) === true;
  if (!terminal)
    throw new DeliveryError(
      "CONFLICT",
      `Test stage Job delivery-worker-jobs/${stage.operationId} is still active or unsettled; keep target ownership`,
    );
  return { uid: job.metadata.uid, fingerprint: fingerprintValue };
}

function requireTerminalTestPods(
  rawPods: readonly Record<string, unknown>[],
  uid: string,
  operationId: string,
) {
  for (const rawPod of rawPods) {
    const pod = TestStagePodSchema.safeParse(rawPod);
    const owned =
      pod.success &&
      pod.data.metadata?.ownerReferences?.some(
        (owner) => owner.kind === "Job" && owner.uid === uid,
      ) === true;
    const settled =
      pod.success &&
      ["Succeeded", "Failed"].includes(pod.data.status?.phase ?? "");
    if (!owned || !settled)
      throw new DeliveryError(
        "CONFLICT",
        `Test stage Job delivery-worker-jobs/${operationId} still has a live or unrelated executor Pod; keep target ownership`,
      );
  }
}

/**
 * Whenever a deployment recorded a `(subN-)?test-*` stage, its in-cluster Job
 * and executor Pods in `delivery-worker-jobs` must be independently observed
 * terminal (or provably uncreated before its receipt) before Argo recovery can
 * settle the deployment (AI-353).
 */
export async function inspectRecordedTestStageJobs(
  detail: DeploymentDetail,
  targets: readonly SyncTarget[],
  readWorkerJobs: KubernetesRead | undefined,
): Promise<EvidenceInput[]> {
  const testStages = detail.stages.filter((stage) =>
    TEST_STAGE_KEY_PATTERN.test(stage.key),
  );
  if (testStages.length === 0) return [];
  const declaredSyncedTests = new Set(
    targets
      .filter((target) =>
        detail.stages.some((entry) => entry.key === target.stage),
      )
      .flatMap((target) => target.declaredStages),
  );
  for (const stage of testStages) {
    if (!declaredSyncedTests.has(stage.key))
      throw new DeliveryError(
        "CONFLICT",
        `Recovery cannot classify test stage ${stage.key} without its declared synced target; keep target ownership`,
      );
  }
  if (readWorkerJobs === undefined)
    throw new DeliveryError(
      "PAUSED",
      "Test-stage recovery requires independent delivery-worker-jobs readback; native Argo settlement alone is insufficient",
    );
  const evidence: EvidenceInput[] = [];
  for (const stage of testStages) {
    if (!/^delivery-[a-f0-9]{40}$/u.test(stage.operationId))
      throw new DeliveryError(
        "CONFLICT",
        `Test stage ${stage.key} lacks a canonical Delivery Job name; keep target ownership`,
      );
    const [rawJob, rawPods] = await Promise.all([
      readWorkerJobs(
        `/apis/batch/v1/namespaces/delivery-worker-jobs/jobs/${encodeURIComponent(stage.operationId)}`,
      ),
      listKubernetes(
        readWorkerJobs,
        `/api/v1/namespaces/delivery-worker-jobs/pods?labelSelector=${encodeURIComponent(`job-name=${stage.operationId}`)}`,
        { maxItems: 20 },
      ),
    ]);
    if (rawJob === null) {
      const uncreated =
        stage.status === "running" &&
        stage.message === "Waiting for an identity-bound revision-pinned Job" &&
        !detail.evidence.some(
          (entry) =>
            entry.operationId === stage.operationId ||
            entry.summary.includes(stage.operationId),
        ) &&
        rawPods.length === 0;
      if (!uncreated)
        throw new DeliveryError(
          "CONFLICT",
          `Test stage Job delivery-worker-jobs/${stage.operationId} is missing or still has executor Pods; keep target ownership`,
        );
      evidence.push({
        kind: "reconciliation",
        operationId: stage.operationId,
        summary: `Read-only test Job delivery-worker-jobs/${stage.operationId} was not created: authenticated GET 404, no recorded native receipt and no executor Pods`,
      });
      continue;
    }
    const { uid, fingerprint: jobFingerprint } = verifyOwnedTestJob(
      rawJob,
      stage,
      detail.deployment.id,
    );
    requireTerminalTestPods(rawPods, uid, stage.operationId);
    evidence.push({
      kind: "reconciliation",
      operationId: uid,
      summary: `Terminal test stage Job delivery-worker-jobs/${stage.operationId}, exact UID ${uid}, fingerprint ${jobFingerprint}`,
    });
  }
  return evidence;
}
