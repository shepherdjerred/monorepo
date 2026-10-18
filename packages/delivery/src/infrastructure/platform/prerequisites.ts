import {
  PlatformReleaseSnapshotSchema,
  type PlatformReleaseSnapshot,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";

async function requireSite(
  tx: Transaction,
  requirement: Extract<
    PlatformReleaseSnapshot["prerequisites"][number],
    { kind: "site" }
  >,
) {
  const accepted = await tx.environment.findUnique({
    where: { id: requirement.environmentId },
  });
  const revisionId = accepted?.acceptedVersionSetRevisionId;
  const matched =
    revisionId === null || revisionId === undefined
      ? 0
      : await tx.versionSetEntry.count({
          where: { revisionId, artifactId: requirement.artifactId },
        });
  if (matched !== 1)
    throw new DeliveryError(
      "BUSY",
      `Waiting for exact site artifact acceptance in ${requirement.environmentId}`,
    );
}

/** These are exact same-source dependencies, not a moving latest selection. */
export async function requirePlatformPrerequisites(
  tx: Transaction,
  snapshot: PlatformReleaseSnapshot,
) {
  for (const requirement of snapshot.prerequisites) {
    if (requirement.kind === "site") {
      await requireSite(tx, requirement);
      continue;
    }
    const kind = requirement.kind === "root" ? "root-release" : "tofu-apply";
    const candidates = await tx.deployment.findMany({
      where: {
        platformSourceBuildId: requirement.sourceBuildId,
        kind,
        status: "succeeded",
        platformAcceptedBy: { some: {} },
      },
      orderBy: { finishedAt: "desc" },
    });
    const matched = candidates.some((row) => {
      const prior = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
      return requirement.kind === "tofu"
        ? prior.kind === "tofu-apply" && prior.stack === requirement.stack
        : prior.kind === "root-release" &&
            fingerprint(
              Object.fromEntries(
                prior.charts.map((chart) => [chart.name, chart.artifact.id]),
              ),
            ) === fingerprint(requirement.rootArtifacts);
    });
    if (!matched)
      throw new DeliveryError(
        "BUSY",
        `Waiting for exact ${requirement.kind === "root" ? "root inventory" : requirement.stack} acceptance from source ${requirement.sourceBuildId}`,
      );
  }
}
