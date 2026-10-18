import { z } from "zod";
import {
  BatchV1Api,
  CoreV1Api,
  type KubeConfig,
  type V1Job,
  type V1Pod,
} from "@kubernetes/client-node";
import {
  ContentRecoveryOwnershipSchema,
  type ContentRecoveryContext,
  type ContentRecoveryOwnership,
  type ContentRecoveryNativeReceipt,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  assertMatchingDeliveryJob,
  deliveryJobManifest,
} from "#lib/delivery/job-manifest.ts";
import { DeliveryJobRequestSchema } from "#shared/delivery-job.ts";
import { forumJobFingerprint } from "./forum-jobs.ts";

export type ContentNativeReader = {
  job: (namespace: string, name: string) => Promise<V1Job>;
  pods: (namespace: string, name: string) => Promise<V1Pod[]>;
};
export function contentNativeReader(config: KubeConfig): ContentNativeReader {
  const jobs = config.makeApiClient(BatchV1Api),
    pods = config.makeApiClient(CoreV1Api);
  return {
    job: async (namespace, name) =>
      await jobs.readNamespacedJob({ namespace, name }),
    pods: async (namespace, name) => {
      const listed = await pods.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${name}`,
      });
      return listed.items;
    },
  };
}

/** Every historical producer is checked. Missing Job alone never establishes
 * target settlement, and still-running Pods invalidate even a Failed condition.
 */
export async function proveContentNativeJobs(
  context: ContentRecoveryContext,
  read: ContentNativeReader,
  activeUIDs: string[] = [],
): Promise<ContentRecoveryOwnership["nativeJobs"]> {
  const result: ContentRecoveryOwnership["nativeJobs"] = [];
  for (const intent of [
    ...context.recoveryHistory.filter(
      (value) => value.id !== context.intent.id,
    ),
    context.intent,
  ]) {
    for (const entry of intent.nativeReceipts) {
      if (activeUIDs.includes(entry.receipt.uid)) continue;
      result.push(await inspectContentReceipt(context, read, entry.receipt));
    }
  }
  return ContentRecoveryOwnershipSchema.shape.nativeJobs.parse(result);
}

async function inspectContentReceipt(
  context: ContentRecoveryContext,
  read: ContentNativeReader,
  receipt: ContentRecoveryNativeReceipt["receipt"],
): Promise<ContentRecoveryOwnership["nativeJobs"][number]> {
  const pods = await read.pods(receipt.namespace, receipt.name);
  let job: V1Job;
  try {
    job = await read.job(receipt.namespace, receipt.name);
  } catch (error) {
    if (!z.object({ code: z.literal(404) }).safeParse(error).success)
      throw error;
    if (pods.length > 0)
      throw new Error("Missing content Job still has executor Pods", {
        cause: error,
      });
    return {
      ...receipt,
      status: "Deleted",
      podsAbsent: true,
      podsTerminal: true,
    };
  }
  if (job.metadata?.uid !== receipt.uid)
    throw new Error("Native content Job was replaced");
  if (receipt.namespace === "delivery-worker-jobs") {
    requireOriginalWorker(context, job, receipt);
  } else if (forumJobFingerprint(job) !== receipt.specFingerprint)
    throw new Error("Native Forum Job specification changed after checkpoint");
  return terminalReceipt(job, pods, receipt);
}

function requireOriginalWorker(
  context: ContentRecoveryContext,
  job: V1Job,
  receipt: ContentRecoveryNativeReceipt["receipt"],
) {
  const encoded = job.spec?.template.spec?.containers[0]?.env?.find(
    (value) => value.name === "DELIVERY_JOB_REQUEST",
  )?.value;
  const request = DeliveryJobRequestSchema.parse(
    JSON.parse(z.string().parse(encoded)),
  );
  const policy = context.deployment.pipeline.definition;
  const stage = context.deployment.stages.find(
    (value) => value.key === request.stageKey,
  );
  if (
    !request.recipe.startsWith("worker-") ||
    request.deploymentId !== context.deployment.deployment.id ||
    policy.kind !== "argocd" ||
    policy.workerRollout?.runnerImage !== request.runnerImage ||
    stage?.operationId !== receipt.name ||
    !stage.message.startsWith("{") ||
    canonicalJson(JSON.parse(stage.message)) !== canonicalJson(receipt)
  )
    throw new Error(
      "Native worker Job is not the exact frozen original stage receipt",
    );
  const expected = deliveryJobManifest(request);
  assertMatchingDeliveryJob(job, expected);
  if (
    request.deploymentId !== receipt.requestId ||
    expected.metadata?.annotations?.[
      "delivery.shepherdjerred.com/fingerprint"
    ] !== receipt.specFingerprint
  )
    throw new Error(
      "Native worker fingerprint differs from its durable receipt",
    );
}

function terminalReceipt(
  job: V1Job,
  pods: V1Pod[],
  receipt: ContentRecoveryNativeReceipt["receipt"],
): ContentRecoveryOwnership["nativeJobs"][number] {
  const condition = job.status?.conditions?.find(
    (value) =>
      ["Complete", "Failed"].includes(value.type) && value.status === "True",
  );
  if (
    condition === undefined ||
    (job.status?.active ?? 0) !== 0 ||
    pods.some(
      (value) =>
        value.metadata?.ownerReferences?.some(
          (owner) => owner.kind === "Job" && owner.uid === receipt.uid,
        ) !== true ||
        !["Succeeded", "Failed"].includes(value.status?.phase ?? ""),
    )
  )
    throw new Error("Native content executor or owned Pods remain live");
  return {
    ...receipt,
    status: z.enum(["Complete", "Failed"]).parse(condition.type),
    podsAbsent: pods.length === 0,
    podsTerminal: true,
  };
}
