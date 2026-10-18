import { createHash } from "node:crypto";
import { z } from "zod";
import {
  BatchV1Api,
  CoreV1Api,
  PatchStrategy,
  setHeaderOptions,
  type KubeConfig,
  type V1Job,
  type V1Pod,
} from "@kubernetes/client-node";
import {
  ContentRecoveryNativeReceiptSchema,
  type ContentRecoveryContext,
  type ContentRecoveryNativeReceipt,
} from "@shepherdjerred/delivery/contract";
import {
  FORUM_RECOVERY_ANNOTATIONS as annotations,
  FORUM_RECOVERY_IMAGE_ABI,
  FORUM_RECOVERY_IMAGE_LABEL,
  ForumStepAcknowledgementSchema,
  type ForumStepAcknowledgement,
} from "@shepherdjerred/ops-model/forum-recovery.ts";
import { ociImageConfigurations } from "@shepherdjerred/ops-model/oci-image-configurations.ts";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  deliveryOperationId,
  deliverySelection,
} from "#lib/delivery/selection.ts";
import { normalizePod } from "#lib/delivery/job-manifest.ts";
import { renderWorkerChart } from "#lib/delivery/workers/worker-control-plane.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";
import type { ContentAction } from "./request.ts";

export function assertNoOtherForumWriter(
  pods: V1Pod[],
  activeChildUID: string,
): void {
  if (
    pods.some(
      (pod) =>
        !["Succeeded", "Failed"].includes(pod.status?.phase ?? "") &&
        pod.metadata?.ownerReferences?.some(
          (owner) => owner.kind === "Job" && owner.uid === activeChildUID,
        ) !== true,
    )
  )
    throw new Error(
      "Another Forum release or operator repair Pod remains live; stop and settle that exact writer before recovery",
    );
}

export function forumJobFingerprint(raw: unknown): string {
  const job = z
    .object({
      spec: z.object({
        template: z.object({
          spec: z.unknown(),
          metadata: z
            .object({
              annotations: z.record(z.string(), z.string()).optional(),
            })
            .optional(),
        }),
        backoffLimit: z.number().optional(),
        activeDeadlineSeconds: z.number().optional(),
        parallelism: z.number().default(1),
        completions: z.number().default(1),
        completionMode: z.string().default("NonIndexed"),
        podFailurePolicy: z.unknown().optional(),
        successPolicy: z.unknown().optional(),
        managedBy: z.string().default("kubernetes.io/job-controller"),
      }),
    })
    .parse(raw);
  return createHash("sha256")
    .update(
      canonicalJson({
        pod: normalizePod(job.spec.template.spec),
        annotations: job.spec.template.metadata?.annotations ?? {},
        backoffLimit: job.spec.backoffLimit ?? null,
        activeDeadlineSeconds: job.spec.activeDeadlineSeconds ?? null,
        parallelism: job.spec.parallelism,
        completions: job.spec.completions,
        completionMode: job.spec.completionMode,
        podFailurePolicy: job.spec.podFailurePolicy ?? null,
        successPolicy: job.spec.successPolicy ?? null,
        managedBy: job.spec.managedBy,
      }),
    )
    .digest("hex");
}

/** Original spec comes from hashed immutable chart bytes, never from caller input. */
export async function originalForumRecoveryJob(
  context: ContentRecoveryContext,
  config: KubeConfig,
  command: RolloutCommandRunner,
) {
  const detail = context.deployment;
  const policy = detail.pipeline.definition;
  if (
    policy.kind !== "argocd" ||
    policy.forumRelease === undefined ||
    !["storm-forum", "storm-forum-beta"].includes(policy.namespace ?? "")
  )
    throw new Error("Forum recovery lacks its fixed native target");
  const image =
    detail.versionSet.components[policy.forumRelease.imageComponent];
  if (image?.kind !== "image")
    throw new Error("Forum original runtime is missing");
  const inspected = await command([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    `${image.uri}@${image.digest}`,
    "--format",
    "{{json .Image}}",
  ]);
  if (
    ociImageConfigurations(JSON.parse(inspected.stdout)).some(
      (value) =>
        value.config.Labels?.["org.opencontainers.image.revision"] !==
          image.sourceRevision ||
        value.config.Labels[FORUM_RECOVERY_IMAGE_LABEL] !==
          FORUM_RECOVERY_IMAGE_ABI,
    )
  )
    throw new Error(
      "Original Forum image lacks its original source or native recovery ABI; legacy unjournaled migrations need reviewed native inspection",
    );
  const selected = deliverySelection(detail);
  const documents = await renderWorkerChart(selected, command);
  const name = `storm-forum-release-${createHash("sha256").update(detail.deployment.id).digest("hex").slice(0, 32)}`;
  const raw = documents
    .filter(
      (value) => z.object({ kind: z.string() }).parse(value).kind === "Job",
    )
    .find(
      (value) =>
        z.object({ metadata: z.object({ name: z.string() }) }).parse(value)
          .metadata.name === name,
    );
  if (raw === undefined)
    throw new Error("Frozen Forum chart lacks its exact original release Job");
  const namespace = z
    .enum(["storm-forum", "storm-forum-beta"])
    .parse(policy.namespace);
  const original = await config
    .makeApiClient(BatchV1Api)
    .readNamespacedJob({ namespace, name });
  if (forumJobFingerprint(original) !== forumJobFingerprint(raw))
    throw new Error(
      "Original native Forum Job differs from the frozen approved chart",
    );
  const receipt = ContentRecoveryNativeReceiptSchema.shape.receipt.parse({
    namespace,
    name,
    uid: original.metadata?.uid,
    specFingerprint: forumJobFingerprint(original),
    requestId: detail.deployment.id,
  });
  return { original, receipt };
}

export function forumRecoveryChild(input: {
  original: V1Job;
  receipt: ContentRecoveryNativeReceipt["receipt"];
  intentId: string;
  action: ContentAction;
  acknowledgement?: ForumStepAcknowledgement;
  attempt: number;
}): V1Job {
  const { original, receipt, intentId, action, attempt } = input;
  const acknowledgement =
    input.acknowledgement === undefined
      ? undefined
      : ForumStepAcknowledgementSchema.parse(input.acknowledgement);
  if (acknowledgement !== undefined && action !== "repair")
    throw new Error("Only explicit Forum repair can acknowledge a step");
  if (
    !original.spec?.template.spec ||
    original.metadata?.uid !== receipt.uid ||
    forumJobFingerprint(original) !== receipt.specFingerprint
  )
    throw new Error(
      "Original Forum Job changed before constructing recovery child",
    );
  const release = original.spec.template.spec.containers.find(
    (value) => value.name === "release",
  );
  if (
    canonicalJson(release?.command) !==
      canonicalJson(["bun", "/opt/storm-forum/src/cli.ts", "release"]) ||
    release?.env?.some(
      (value) =>
        value.name === "FORUM_RECOVERY_INTENT_ID" &&
        value.valueFrom?.fieldRef?.fieldPath ===
          `metadata.annotations['${annotations.intent}']`,
    ) !== true
  )
    throw new Error(
      "Original Forum Job lacks the fixed native recovery protocol",
    );
  const requestId = deliveryOperationId(`${intentId}:${action}`);
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      namespace: receipt.namespace,
      name: `delivery-forum-recovery-${createHash("sha256")
        .update(`${intentId}:${action}:${String(attempt)}`)
        .digest("hex")
        .slice(0, 32)}`,
      annotations: {
        [annotations.originalUID]: receipt.uid,
        [annotations.originalName]: receipt.name,
        [annotations.request]: requestId,
      },
    },
    spec: {
      suspend: true,
      backoffLimit: 0,
      parallelism: 1,
      completions: 1,
      activeDeadlineSeconds: 3600,
      template: {
        metadata: {
          labels: { app: "storm-forum", component: "release" },
          annotations: {
            [annotations.intent]: intentId,
            [annotations.action]:
              acknowledgement === undefined
                ? action
                : `repair:${acknowledgement.step}:${acknowledgement.journalSha256}`,
          },
        },
        spec: structuredClone(original.spec.template.spec),
      },
    },
  };
}

export async function runForumRecoveryChild(input: {
  original: V1Job;
  receipt: ContentRecoveryNativeReceipt["receipt"];
  intentId: string;
  action: ContentAction;
  acknowledgement?: ForumStepAcknowledgement;
  attempt: number;
  config: KubeConfig;
  checkpoint: (
    receipt: ContentRecoveryNativeReceipt["receipt"],
  ) => Promise<void>;
  fence: (activeChildUID: string) => Promise<void>;
}) {
  const jobs = input.config.makeApiClient(BatchV1Api),
    pods = input.config.makeApiClient(CoreV1Api);
  const expected = forumRecoveryChild(input);
  const namespace = input.receipt.namespace,
    name = z.string().parse(expected.metadata?.name);
  let actual: V1Job;
  try {
    actual = await jobs.readNamespacedJob({ namespace, name });
  } catch (error) {
    if (!z.object({ code: z.literal(404) }).safeParse(error).success)
      throw error;
    actual = await jobs.createNamespacedJob({ namespace, body: expected });
  }
  const same = (job: V1Job) => {
    if (
      forumJobFingerprint(job) !== forumJobFingerprint(expected) ||
      canonicalJson(job.metadata?.annotations) !==
        canonicalJson(expected.metadata?.annotations)
    )
      throw new Error(
        "Forum recovery child differs from its exact original specification",
      );
  };
  same(actual);
  const receipt = ContentRecoveryNativeReceiptSchema.shape.receipt.parse({
    namespace,
    name,
    uid: actual.metadata?.uid,
    specFingerprint: forumJobFingerprint(expected),
    requestId: deliveryOperationId(`${input.intentId}:${input.action}`),
  });
  await input.checkpoint(receipt);
  await input.fence(receipt.uid);
  const writers = await pods.listNamespacedPod({
    namespace,
    labelSelector: "app=storm-forum,component=release",
  });
  assertNoOtherForumWriter(writers.items, receipt.uid);
  if (actual.spec?.suspend === true) {
    await jobs.patchNamespacedJob(
      {
        namespace,
        name,
        body: [
          { op: "test", path: "/metadata/uid", value: receipt.uid },
          {
            op: "test",
            path: "/metadata/resourceVersion",
            value: actual.metadata?.resourceVersion,
          },
          { op: "test", path: "/spec/suspend", value: true },
          { op: "replace", path: "/spec/suspend", value: false },
        ],
      },
      setHeaderOptions("Content-Type", PatchStrategy.JsonPatch),
    );
  }
  await waitForForumRecoveryChild(jobs, receipt, same);
  const listed = await pods.listNamespacedPod({
    namespace,
    labelSelector: `job-name=${name}`,
  });
  if (
    listed.items.length !== 1 ||
    listed.items.some(
      (value) =>
        value.status?.phase !== "Succeeded" ||
        value.metadata?.ownerReferences?.some(
          (owner) => owner.kind === "Job" && owner.uid === receipt.uid,
        ) !== true,
    )
  )
    throw new Error("Forum recovery has no unique terminal owned Pod");
  const logs = await pods.readNamespacedPodLog({
    namespace,
    name: z.string().parse(listed.items[0]?.metadata?.name),
    container: "release",
    limitBytes: 65_536,
  });
  const results = logs
    .split("\n")
    .filter((line) => line.startsWith("FORUM_RECOVERY_RESULT_V1="));
  if (results.length !== 1)
    throw new Error("Forum recovery has no unique native proof");
  return JSON.parse(
    z.string().parse(results[0]).slice("FORUM_RECOVERY_RESULT_V1=".length),
  ) as unknown;
}

async function waitForForumRecoveryChild(
  jobs: BatchV1Api,
  receipt: ContentRecoveryNativeReceipt["receipt"],
  same: (job: V1Job) => void,
) {
  const { namespace, name } = receipt;
  let actual: V1Job;
  for (let index = 0; index < 720; index++) {
    actual = await jobs.readNamespacedJob({ namespace, name });
    same(actual);
    if (actual.metadata?.uid !== receipt.uid)
      throw new Error("Forum recovery child was replaced");
    const condition = actual.status?.conditions?.find(
      (value) =>
        value.status === "True" && ["Complete", "Failed"].includes(value.type),
    );
    if (condition?.type === "Failed")
      throw new Error(
        "Native Forum recovery failed; retain its exact journal and quarantine",
      );
    if (condition?.type === "Complete") break;
    if (index === 719)
      throw new Error(
        "Native Forum recovery did not settle within its fixed deadline",
      );
    await Bun.sleep(5000);
  }
}
