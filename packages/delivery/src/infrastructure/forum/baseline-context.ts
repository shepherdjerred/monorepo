import type { Database } from "#infrastructure/database.ts";
import {
  artifact,
  configurationRevision,
  environment,
} from "#infrastructure/delivery-data.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  fingerprint,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { LegacyPipelineRevisionSchema } from "#shared/contract.ts";
import type { ArtifactVersion } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";

/**
 * The independently observed original runtime of a forum environment: its
 * latest succeeded baseline intent. The baseline is evidence, never an
 * accepted pointer, and settling it does not move the generation (E1).
 */
export async function acceptedForumBaseline(
  tx: Transaction | Database,
  environmentId: string,
) {
  return tx.forumBaselineIntent.findFirst({
    where: { environmentId, status: "succeeded" },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
  });
}

function originalRuntime(image: ArtifactVersion, component: string) {
  if (
    image.serviceId !== "storm-forum" ||
    image.kind !== "image" ||
    image.component !== component ||
    image.uri !== "docker.io/shepherdjerred/storm-forum" ||
    image.origin.kind !== "first-party" ||
    image.runtimeDigests.length === 0
  )
    throw new DeliveryError(
      "INVALID",
      "Forum baseline requires its original qualified runtime with observed platform digests",
    );
}

export async function forumBaselineInputs(
  tx: Transaction | Database,
  input: {
    environmentId: string;
    expectedEnvironmentGeneration: number;
    imageArtifactId: string;
    bundleArtifactId: string;
  },
) {
  const env = await environment(tx, input.environmentId);
  if (
    env.serviceId !== "storm-forum" ||
    env.generation !== input.expectedEnvironmentGeneration ||
    env.activeDeploymentId !== null ||
    env.acceptedVersionSetRevisionId !== null
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum baseline requires an idle original environment at the exact generation, before any accepted deployment",
    );
  const pipeline = LegacyPipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({ where: { id: env.pipelineRevisionId } }),
        "Forum pipeline",
      ),
    ),
  );
  const definition = pipeline.definition;
  if (
    definition.kind !== "argocd" ||
    definition.forumRelease === undefined ||
    definition.application !== env.application ||
    !["storm-forum", "storm-forum-beta"].includes(definition.application)
  )
    throw new DeliveryError(
      "INVALID",
      "Forum baseline requires its reviewed canonical release pipeline",
    );
  const held = await tx.targetLock.findUnique({
    where: { instance: `application:${definition.application}` },
  });
  if (held !== null)
    throw new DeliveryError(
      "BUSY",
      "Forum Application is held by an active or quarantined deployment",
    );
  const image = await artifact(tx, input.imageArtifactId),
    bundle = await artifact(tx, input.bundleArtifactId);
  originalRuntime(image, definition.forumRelease.imageComponent);
  if (
    bundle.serviceId !== "storm-forum" ||
    bundle.kind !== "archive" ||
    bundle.component !== definition.forumRelease.bundleComponent ||
    bundle.origin.kind !== "licensed-bundle" ||
    bundle.version !== bundle.origin.xenforoVersion ||
    bundle.uri !==
      `s3://storm-forum-releases/releases/${bundle.digest.slice(7)}.zip`
  )
    throw new DeliveryError(
      "INVALID",
      "Forum baseline requires an independently qualified original licensed bundle",
    );
  const previousBaseline = await acceptedForumBaseline(tx, env.id);
  const snapshotFingerprint = fingerprint({
    environmentId: env.id,
    generation: env.generation,
    previousBaselineIntentId: previousBaseline?.id ?? null,
    pipeline,
    configuration: await configurationRevision(tx, env.declaredConfigurationId),
    image,
    bundle,
  });
  return { environment: env, pipeline, image, bundle, snapshotFingerprint };
}

export async function lockForumBaseline(
  tx: Transaction,
  environmentId: string,
) {
  await lock(tx, `environment:${environmentId}`);
  await tx.$queryRaw`SELECT "id" FROM "Environment" WHERE "id" = ${environmentId} FOR UPDATE`;
}
