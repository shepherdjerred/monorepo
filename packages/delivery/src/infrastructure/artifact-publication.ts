import { DeliveryError } from "#domain/error.ts";
import type { PublishBuild } from "#shared/contract.ts";
import { artifactView, type Transaction } from "./delivery-data.ts";
import { required } from "./delivery-records.ts";

/**
 * A retained original must be verified, or pending in an earlier main pipeline
 * of this repository: qualification then waits for that build (B2), and an
 * order key below this one means a build never waits on itself or a later one.
 */
async function retainedOriginal(
  tx: Transaction,
  artifactId: string,
  ci: { repositoryId: number; pipelineNumber: number },
) {
  const row = required(
    await tx.artifact.findUnique({
      where: { id: artifactId },
      include: { build: true },
    }),
    "Artifact",
  );
  const { build } = row;
  if (build.status === "verified")
    return { original: artifactView(row), build };
  if (
    build.status === "pending" &&
    build.sourceKind === "ci" &&
    build.repositoryId === ci.repositoryId &&
    build.pipelineNumber !== null &&
    build.pipelineNumber < ci.pipelineNumber
  )
    return { original: artifactView(row), build };
  throw new DeliveryError(
    "CONFLICT",
    build.status === "pending"
      ? `Retained artifact ${artifactId} is pending outside an earlier main pipeline of this repository`
      : "Artifact build has not passed CI qualification",
  );
}

export async function publicationSelections(
  tx: Transaction,
  input: PublishBuild,
  ci: { repositoryId: number; pipelineNumber: number },
) {
  const { repositoryId } = ci;
  const selected = new Map<string, string>();
  for (const output of input.artifacts) {
    if (
      output.origin?.kind !== undefined &&
      output.origin.kind !== "first-party"
    )
      throw new DeliveryError(
        "INVALID",
        "External artifacts require independent acquisition and verification before CI may retain their original identity",
      );
    selected.set(output.component, output.id);
  }
  for (const artifactId of input.retainedArtifactIds ?? []) {
    const { original, build } = await retainedOriginal(tx, artifactId, ci);
    if (
      original.serviceId !== input.serviceId ||
      (build.sourceKind === "ci" && build.repositoryId !== repositoryId)
    )
      throw new DeliveryError(
        "INVALID",
        "Retained artifact belongs to another service or canonical repository",
      );
    if (selected.has(original.component))
      throw new DeliveryError(
        "INVALID",
        "Publication must select one exact original artifact per component",
      );
    selected.set(original.component, original.id);
  }
  if (new Set(selected.values()).size !== selected.size)
    throw new DeliveryError("INVALID", "Retained artifact IDs must be unique");
  return [...selected].map(([component, artifactId]) => ({
    component,
    artifactId,
  }));
}
