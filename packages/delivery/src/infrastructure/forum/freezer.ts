import type {
  Environment,
  PipelineRevision,
  VersionSetRevision,
} from "#shared/contract.ts";
import { ForumBaselineSnapshotSchema } from "#shared/forum-contract.ts";
import type { ForumBaselineSnapshot } from "#shared/forum-contract.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { artifact } from "#infrastructure/delivery-data.ts";
import { required, wire } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";

export function validateForumCandidate(
  pipeline: PipelineRevision,
  selected: VersionSetRevision,
  configuration: Record<string, string>,
) {
  const definition = pipeline.definition;
  if (definition.kind !== "argocd" || definition.forumRelease === undefined)
    return;
  const bundle = selected.components[definition.forumRelease.bundleComponent];
  if (
    bundle?.origin.kind !== "licensed-bundle" ||
    bundle.serviceId !== "storm-forum" ||
    bundle.component !== "archive:forum-bundle" ||
    bundle.origin.xenforoVersion !== bundle.version ||
    configuration["forum.xenforoVersion"] !== bundle.version
  )
    throw new DeliveryError(
      "INVALID",
      "Forum candidate must retain the independently qualified licensed bundle matching the reviewed neutral version and dependency policy",
    );
}

function originalProof(snapshot: ForumBaselineSnapshot) {
  if (
    snapshot.image.serviceId !== "storm-forum" ||
    snapshot.image.kind !== "image" ||
    snapshot.image.uri !== "docker.io/shepherdjerred/storm-forum" ||
    snapshot.bundle.serviceId !== "storm-forum" ||
    snapshot.bundle.origin.kind !== "licensed-bundle"
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum original baseline artifact identities no longer match",
    );
  if (
    snapshot.proof.imageArtifactId !== snapshot.image.id ||
    snapshot.proof.bundleArtifactId !== snapshot.bundle.id ||
    snapshot.proof.bundleDigest !== snapshot.bundle.digest ||
    snapshot.proof.runtimeImage !==
      `${snapshot.image.uri}@${snapshot.image.digest}` ||
    snapshot.proof.runtime.bundleSha256 !== snapshot.bundle.digest.slice(7) ||
    snapshot.proof.runtime.xenforoVersion !== snapshot.bundle.version
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum original baseline native proof no longer matches",
    );
}

/** Baseline is an original-runtime migration input, never an invented accepted application version set. */
export async function freezeForumBaseline(
  tx: Transaction,
  input: {
    environment: Environment;
    pipeline: PipelineRevision;
    recoveredRuntime?: boolean;
  },
) {
  const { environment, pipeline } = input;
  if (
    pipeline.definition.kind !== "argocd" ||
    pipeline.definition.forumRelease === undefined
  )
    return null;
  if (
    (await tx.forumBaselineIntent.findFirst({
      where: { environmentId: environment.id, status: "pending" },
    })) !== null
  )
    throw new DeliveryError(
      "BUSY",
      "Forum original baseline observation is still pending",
    );
  if (
    input.recoveredRuntime === true ||
    environment.acceptedVersionSetRevisionId !== null
  )
    return null;
  if (environment.acceptedForumBaselineIntentId === null)
    throw new DeliveryError(
      "CONFLICT",
      "Forum initial upgrade requires an independently observed original runtime baseline",
    );
  const baseline = required(
    await tx.forumBaselineIntent.findUnique({
      where: { id: environment.acceptedForumBaselineIntentId },
    }),
    "Original forum baseline",
  );
  if (
    baseline.status !== "succeeded" ||
    baseline.environmentId !== environment.id ||
    baseline.pipelineRevisionId !== pipeline.id ||
    baseline.configurationRevision !== environment.configurationRevision ||
    baseline.expectedEnvironmentGeneration + 1 > environment.generation
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum original baseline does not belong to this exact frozen environment generation and pipeline",
    );
  const snapshot = ForumBaselineSnapshotSchema.parse({
    intentId: baseline.id,
    image: await artifact(tx, baseline.imageArtifactId),
    bundle: await artifact(tx, baseline.bundleArtifactId),
    proof: wire(baseline.proof),
  });
  originalProof(snapshot);
  return snapshot;
}
