import type { Database } from "#infrastructure/database.ts";
import { artifact, environment } from "#infrastructure/delivery-data.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  fingerprint,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import type { ArtifactVersion } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";

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
  const pipeline = PipelineRevisionSchema.parse(
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
  const held = await tx.applicationLock.findUnique({
    where: { application: definition.application },
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
  const snapshotFingerprint = fingerprint({
    environmentId: env.id,
    generation: env.generation,
    previousBaselineIntentId: env.acceptedForumBaselineIntentId,
    pipeline,
    configurationRevision: env.configurationRevision,
    configuration: env.configuration,
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
