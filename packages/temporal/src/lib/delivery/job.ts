import {
  BatchV1Api,
  CoreV1Api,
  KubeConfig,
  type V1Job,
} from "@kubernetes/client-node";
import { Context } from "@temporalio/activity";
import { z } from "zod";
import {
  deliveryJobManifest,
  assertMatchingDeliveryJob,
} from "./job-manifest.ts";
import {
  DELIVERY_JOB_RESULT_PREFIX,
  DeliveryJobReceiptSchema,
  type DeliveryJobRequest,
  type DeliveryJobReceipt,
} from "#shared/delivery-job.ts";

function statusCode(error: unknown) {
  return z.object({ code: z.number() }).safeParse(error).data?.code;
}

async function getOrCreateJob(
  jobs: BatchV1Api,
  expected: V1Job,
  namespace: string,
  name: string,
): Promise<V1Job> {
  try {
    return await jobs.readNamespacedJob({ namespace, name });
  } catch (error) {
    if (statusCode(error) !== 404) throw error;
    try {
      return await jobs.createNamespacedJob({ namespace, body: expected });
    } catch (createError) {
      if (statusCode(createError) !== 409) throw createError;
      return await jobs.readNamespacedJob({ namespace, name });
    }
  }
}

async function waitForJob(
  jobs: BatchV1Api,
  expected: V1Job,
  receipt: DeliveryJobReceipt,
): Promise<void> {
  const context = Context.current();
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  for (;;) {
    context.heartbeat(receipt);
    if (context.cancellationSignal.aborted)
      throw new Error(
        "Delivery Job canceled; inspect its recorded UID before recovery",
      );
    const job = await jobs.readNamespacedJob({
      namespace: receipt.namespace,
      name: receipt.name,
    });
    assertMatchingDeliveryJob(job, expected);
    if (job.metadata?.uid !== receipt.uid)
      throw new Error(
        "Delivery Job was replaced after its receipt was recorded",
      );
    if (
      job.status?.conditions?.some(
        (condition) =>
          condition.type === "Failed" && condition.status === "True",
      ) === true
    )
      throw new Error(
        "Delivery Job failed; inspect its recorded UID and bounded stage logs",
      );
    if (
      job.status?.conditions?.some(
        (condition) =>
          condition.type === "Complete" && condition.status === "True",
      ) === true
    )
      return;
    if (Date.now() > deadline)
      throw new Error(
        "Delivery Job exceeded its admission/execution deadline; retain ownership until inspected",
      );
    await Bun.sleep(10_000);
  }
}

/** A lost create response never creates another name or retries a terminal Job. */
export async function runDeliveryJob(
  input: DeliveryJobRequest,
  onReceipt: (receipt: DeliveryJobReceipt) => Promise<void>,
): Promise<unknown> {
  const config = new KubeConfig();
  config.loadFromCluster();
  const jobs = config.makeApiClient(BatchV1Api);
  const pods = config.makeApiClient(CoreV1Api);
  const expected = deliveryJobManifest(input);
  const namespace = "delivery-jobs";
  const name = z.string().parse(expected.metadata?.name);
  const job = await getOrCreateJob(jobs, expected, namespace, name);
  assertMatchingDeliveryJob(job, expected);
  const receipt = DeliveryJobReceiptSchema.parse({
    namespace,
    name,
    uid: job.metadata?.uid,
    specFingerprint:
      expected.metadata?.annotations?.[
        "delivery.shepherdjerred.com/fingerprint"
      ],
    requestId: input.deploymentId,
  });
  await onReceipt(receipt);
  await waitForJob(jobs, expected, receipt);
  const listed = await pods.listNamespacedPod({
    namespace,
    labelSelector: `job-name=${name}`,
  });
  const owned = listed.items.filter(
    (pod) =>
      pod.metadata?.ownerReferences?.some(
        (owner) => owner.kind === "Job" && owner.uid === receipt.uid,
      ) === true,
  );
  if (owned.length !== 1 || owned[0]?.metadata?.name === undefined)
    throw new Error("Completed delivery Job has no unique owned Pod");
  const logs = await pods.readNamespacedPodLog({
    namespace,
    name: owned[0].metadata.name,
    container: "stage",
    limitBytes: 1_000_000,
  });
  const results = logs
    .split("\n")
    .filter((line) => line.startsWith(DELIVERY_JOB_RESULT_PREFIX));
  if (results.length !== 1)
    throw new Error("Delivery Job has no unique structured result receipt");
  const result: unknown = JSON.parse(
    z.string().parse(results[0]).slice(DELIVERY_JOB_RESULT_PREFIX.length),
  );
  return result;
}
