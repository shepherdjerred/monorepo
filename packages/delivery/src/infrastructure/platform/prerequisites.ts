import {
  PlatformReleaseSnapshotSchema,
  type PlatformReleaseSnapshot,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { RETIRED_ROOT } from "./policy.ts";

/** These are exact same-source dependencies, not a moving latest selection. */
export async function requirePlatformPrerequisites(
  tx: Transaction,
  snapshot: PlatformReleaseSnapshot,
) {
  for (const requirement of snapshot.prerequisites) {
    // Root inventories and shared-site bindings are retired (X4, X6).
    if (requirement.kind !== "tofu")
      throw new DeliveryError("INVALID", RETIRED_ROOT);
    const candidates = await tx.deployment.findMany({
      where: {
        platformSourceBuildId: requirement.sourceBuildId,
        kind: "tofu-apply",
        status: "succeeded",
        acceptedBy: { some: {} },
      },
      orderBy: { finishedAt: "desc" },
    });
    const matched = candidates.some((row) => {
      const prior = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
      return prior.kind === "tofu-apply" && prior.stack === requirement.stack;
    });
    if (!matched)
      throw new DeliveryError(
        "BUSY",
        `Waiting for exact ${requirement.stack} acceptance from source ${requirement.sourceBuildId}`,
      );
  }
}
