import type { Prisma } from "#generated/prisma/client.ts";
import { assertRetentionPlexProjection } from "#infrastructure/plex-binding/retention.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { assertBoundMediaCohort } from "./binding.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Missing or changed pre-quarantine authority retires the entire old warning group. */
export async function reconcileRetentionProjection(
  tx: Prisma.TransactionClient,
  input: {
    mediaIds: string[];
    binding: Awaited<ReturnType<typeof assertBoundMediaCohort>>;
    edition?: MovieEditionKey;
    budget?: PublicationAuthorityReadBudget;
  },
  freshness: PlexBindingFreshness,
) {
  const decisions = await tx.retentionDecision.findMany({
    where: {
      mediaId: { in: input.mediaIds },
      edition: input.edition ?? "default",
      state: {
        in: ["eligible", "warning_pending", "grace_period", "quarantined"],
      },
    },
    orderBy: { id: "asc" },
  });
  let replace = false;
  for (const decision of decisions) {
    try {
      await assertRetentionPlexProjection(
        tx,
        {
          decisionId: decision.id,
          groups: input.binding.groups,
          bindings: input.binding.bindings,
        },
        freshness,
        input.budget,
      );
    } catch (error) {
      if (!(error instanceof PlexBindingProtection)) throw error;
      if (decision.state === "quarantined") throw error;
      replace = true;
    }
  }
  if (replace) {
    await tx.retentionDecision.updateMany({
      where: {
        mediaId: { in: input.mediaIds },
        edition: input.edition ?? "default",
        state: { in: ["eligible", "warning_pending", "grace_period"] },
      },
      data: { state: "cancelled", version: { increment: 1 } },
    });
    freshness.assertActive();
  }
}
