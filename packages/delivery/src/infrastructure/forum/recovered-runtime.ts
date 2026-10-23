import { applicationOf, forumReleaseOf } from "#shared/model/recipe-view.ts";
import { bareFingerprint } from "#infrastructure/recovery-intents.ts";
import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import {
  configurationContent,
  version,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  fingerprint,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  CompleteContentRecoverySchema,
  DeploymentSchema,
  ForumRecoveredRuntimeSchema,
  PipelineRevisionSchema,
  type PipelineRevision,
  type VersionSetRevision,
} from "#shared/contract.ts";
import { contentSettlement } from "#infrastructure/content-recovery/context.ts";

function originalRuntime(
  selected: VersionSetRevision,
  policy: { imageComponent: string; bundleComponent: string },
  rawConfiguration: unknown,
) {
  const image = selected.components[policy.imageComponent];
  const bundle = selected.components[policy.bundleComponent];
  const configuration = z
    .record(z.string(), z.string())
    .parse(rawConfiguration);
  if (
    image?.kind !== "image" ||
    image.serviceId !== "storm-forum" ||
    image.uri !== "docker.io/shepherdjerred/storm-forum" ||
    bundle?.kind !== "archive" ||
    bundle.serviceId !== "storm-forum" ||
    bundle.origin.kind !== "licensed-bundle" ||
    bundle.version !== configuration["forum.xenforoVersion"] ||
    bundle.origin.xenforoVersion !== bundle.version
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum recovered runtime lost its original qualified image or licensed bundle",
    );
  return { image, bundle, xenforoVersion: bundle.version };
}

/** Native settlement supplies a backup input, never application acceptance. */
export async function freezeRecoveredForumRuntime(
  tx: Transaction,
  input: {
    environmentId: string;
    pipeline: PipelineRevision;
    acceptedAt: Date | null;
  },
) {
  const policy = applicationOf(input.pipeline.definition);
  if (
    policy === null ||
    forumReleaseOf(input.pipeline.definition) === undefined
  )
    return null;
  const recovery = await tx.recoveryIntent.findFirst({
    where: {
      kind: "content",
      status: "succeeded",
      detail: { path: ["targetKind"], equals: "forum" },
      deployment: {
        environmentId: input.environmentId,
        serviceId: "storm-forum",
      },
      ...(input.acceptedAt === null
        ? {}
        : { finishedAt: { gt: input.acceptedAt } }),
    },
    include: { deployment: true },
    orderBy: { finishedAt: "desc" },
  });
  if (recovery === null) return null;
  const event = required(
    await tx.audit.findFirst({
      where: { entityId: recovery.id, action: "content.recovery_completed" },
    }),
    "Forum recovery settlement proof",
  );
  const proof = CompleteContentRecoverySchema.parse(event.metadata);
  if (
    recovery.resultFingerprint !== fingerprint(proof) ||
    proof.snapshotFingerprint !== bareFingerprint(recovery.fingerprint)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum recovery settlement identity changed",
    );
  if (proof.settlement.state !== "desired") return null;
  const source = recovery.deployment;
  const original = PipelineRevisionSchema.parse(
    wire(
      await tx.pipeline.findUniqueOrThrow({
        where: { id: source.pipelineRevisionId },
      }),
    ),
  );
  if (source.status !== "failed" && source.status !== "canceled")
    throw new DeliveryError(
      "CONFLICT",
      "Forum recovery cannot replace an accepted release",
    );
  const originalForum = forumReleaseOf(original.definition);
  if (
    originalForum === undefined ||
    applicationOf(original.definition)?.name !== policy.name
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum recovered runtime belongs to another native target",
    );
  const selected = await version(tx, source.versionSetRevisionId);
  if (
    proof.settlement.fingerprint !==
    contentSettlement({
      pipeline: original,
      versionSet: selected,
      environment: { id: source.environmentId },
      deployment: DeploymentSchema.parse(wire(source)),
      forumRecoveredRuntime: await readRecoveredForumRuntime(tx, source.id),
    })
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum desired settlement differs from its exact frozen original source",
    );
  return ForumRecoveredRuntimeSchema.parse({
    recoveryIntentId: recovery.id,
    deploymentId: source.id,
    ...originalRuntime(
      selected,
      originalForum,
      await configurationContent(tx, source.configurationId),
    ),
  });
}

/** Read only the request-time snapshot, never a moving latest recovery. */
export async function readRecoveredForumRuntime(
  database: Database | Transaction,
  deploymentId: string,
) {
  const event = await database.audit.findFirst({
    where: { entityId: deploymentId, action: "deployment.requested" },
    select: { metadata: true },
  });
  return (
    z
      .object({ forumRecoveredRuntime: ForumRecoveredRuntimeSchema.optional() })
      .parse(event?.metadata ?? {}).forumRecoveredRuntime ?? null
  );
}
