import { DeliveryError } from "#domain/error.ts";
import type { PublishBuild } from "#shared/contract.ts";
import { artifact, type Transaction } from "./delivery-data.ts";

export async function publicationSelections(
  tx: Transaction,
  input: PublishBuild,
  repositoryId: number,
) {
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
    const original = await artifact(tx, artifactId);
    const build = await tx.build.findUniqueOrThrow({
      where: { id: original.buildId },
    });
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
