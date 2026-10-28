import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  UpgradeCleanupPlexInputSchema,
  ObserveMediaUpgradeCleanupResultSchema,
  type UpgradeCleanupPlexInput,
  type ObserveMediaUpgradeCleanupResult,
} from "#shared/plex-binding/cleanup.ts";
import { readUpgradeCleanupCommand } from "#infrastructure/plex-binding/cleanup-scope.ts";
import {
  prepareUpgradeCleanupObservation,
  commitUpgradeCleanupObservation,
} from "#infrastructure/plex-binding/cleanup.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { verifyPlexAssociations } from "#automation/publication/association.ts";
import { observeSessionPlayback } from "#automation/retention/sessions.ts";
import { serializable } from "#automation/store.ts";
import { bindingAccess } from "./access.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { verifyMoviePlexV2 } from "#automation/movie-editions/plex-verification.ts";

/** Only Network owns authenticated Plex IO; Files receives the exact durable operation proof. */
export async function observeMediaUpgradeCleanup(
  context: MediaAutomationContext,
  raw: UpgradeCleanupPlexInput,
  execution: PlexBindingExecution,
): Promise<ObserveMediaUpgradeCleanupResult> {
  execution.assertActive();
  const invocation = {
    budget:
      context.movieManagement?.budget ??
      context.libraryManagement?.budget ??
      new PublicationAuthorityReadBudget(),
    policyTime: context.now?.() ?? new Date(),
  };
  const input = UpgradeCleanupPlexInputSchema.parse(raw);
  const initial = await readUpgradeCleanupCommand(context.db, input);
  execution.assertActive();
  // This deliberately does not replace the unchanged Files purged-row ACK.
  if (initial.cleanup.state === "purged") return { status: "complete" };
  try {
    const freshness = plexBindingFreshness({
      ...execution,
      guards: [execution],
    });
    // This is only requested-kind discovery from the exact historical successor.
    // A later upgrade may have superseded it. The captured cleanup scope below
    // resolves and verifies the complete current serving group independently.
    const coverage = await context.db.assetCoverage.findMany({
      where: { assetId: initial.cleanup.successorAssetId },
      select: { media: { select: { kind: true } } },
    });
    freshness.assertActive();
    if (
      coverage.length === 0 ||
      coverage.some(
        (row) => row.media.kind !== "movie" && row.media.kind !== "episode",
      )
    )
      throw new PlexBindingProtection("scope_changed");
    const access = await bindingAccess(
      context,
      coverage.map((row) => (row.media.kind === "movie" ? "movie" : "show")),
    );
    freshness.assertActive();
    const prepared = await serializable(context.db, async (tx) => {
      const result = await prepareUpgradeCleanupObservation(tx, input, access, {
        ...invocation,
        freshness,
      });
      execution.assertActive();
      if (result.status === "complete") return result;
      const canonicalTargets = await readPlexCanonicalTargets(
        tx,
        result.expected.serving.targets.map((target) => target.scope),
      );
      result.freshness.assertActive();
      return { ...result, canonicalTargets };
    });
    if (prepared.status === "complete") return prepared;
    const { expected } = prepared;
    const verify =
      expected.schemaVersion === 2 ? verifyMoviePlexV2 : verifyPlexAssociations;
    const verified = await verify(
      context,
      {
        purpose: "current_serving",
        expected: expected.serving,
        canonicalTargets: prepared.canonicalTargets,
        access,
        observed: execution.observed,
        expiresAtMs: prepared.freshness.expiresAtMs,
        guards: [prepared.freshness],
      },
      execution,
    );
    if ("status" in verified) throw new PlexBindingProtection(verified.reason);
    const sessions = await observeSessionPlayback(
      context,
      {
        access,
        original: verified.associations.map((association) => ({ association })),
        paths: expected.paths,
      },
      execution,
      verified.freshness,
    );
    if (sessions.active || sessions.checkedAt === null)
      throw new PlexBindingProtection("reconciliation_required");
    verified.freshness.assertActive();
    const completedAt = new Date().toISOString();
    await serializable(context.db, (tx) =>
      commitUpgradeCleanupObservation(
        tx,
        expected,
        {
          serving: verified,
          sessions: {
            state: "clear",
            pathsHash: expected.pathsHash,
            checkedAt: sessions.checkedAt,
          },
          startedAt: new Date(execution.observed.wall).toISOString(),
          completedAt,
          expiresAt: new Date(verified.freshness.expiresAtMs).toISOString(),
        },
        { ...invocation, freshness: verified.freshness },
      ),
    );
    verified.freshness.assertActive();
    return ObserveMediaUpgradeCleanupResultSchema.parse({ status: "observed" });
  } catch (error) {
    execution.assertActive();
    if (!(error instanceof PlexBindingProtection)) throw error;
    const current = await readUpgradeCleanupCommand(context.db, input);
    execution.assertActive();
    return current.cleanup.state === "purged"
      ? { status: "complete" }
      : { status: "protected", reason: error.reason };
  }
}
