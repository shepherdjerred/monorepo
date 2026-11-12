import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { captureExistingPlexBindingExpected } from "#infrastructure/plex-binding/cold.ts";
import {
  preparePlexBindingLockScope,
  lockPlexBindingScope,
} from "#infrastructure/plex-binding/authority.ts";
import { queuePlexBindingReverification } from "#infrastructure/plex-binding/store.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { bindingAccess } from "./access.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { movieInventoryParent } from "#infrastructure/movie-editions/plex/inventory/expected.ts";

export async function queueExistingPlexBinding(
  context: MediaAutomationContext,
  assetId: string,
) {
  const execution = context.plexBindingExecution();
  const { observed, expiresAtMs } = execution;
  const budget = new PublicationAuthorityReadBudget();
  try {
    const freshness = plexBindingFreshness({
      observed,
      expiresAtMs,
      guards: [execution],
    });
    const coverage = await context.db.assetCoverage.findMany({
      where: { assetId, current: true },
      include: { media: { select: { kind: true } } },
    });
    if (coverage.every((value) => value.media.kind === "movie"))
      budget.consume(coverage.length * 2);
    freshness.assertActive();
    if (
      coverage.length === 0 ||
      coverage.some(
        (value) =>
          (value.edition !== "default" && value.media.kind !== "movie") ||
          !["movie", "episode"].includes(value.media.kind),
      )
    ) {
      throw new PlexBindingProtection("scope_changed");
    }
    const access = await bindingAccess(
      context,
      coverage.map((value) =>
        value.media.kind === "movie" ? "movie" : "show",
      ),
    );
    freshness.assertActive();
    return await serializable(context.db, async (tx) => {
      const expected = await captureExistingPlexBindingExpected(
        tx,
        {
          assetIds: [assetId],
          access,
        },
        budget,
      );
      const movie = movieInventoryParent(expected);
      if (
        movie === null &&
        coverage.some((value) => value.edition !== "default")
      )
        throw new PlexBindingProtection("scope_changed");
      const scope = await preparePlexBindingLockScope(tx, expected);
      await lockPlexBindingScope(
        tx,
        scope,
        freshness,
        movie === null ? {} : { budget },
      );
      const queued = await queuePlexBindingReverification(
        tx,
        {
          expected,
          renewalBucket: Math.floor(observed.wall / 3_600_000),
        },
        movie === null ? undefined : budget,
      );
      freshness.assertActive();
      return { status: "queued" as const, ...queued };
    });
  } catch (error) {
    execution.assertActive();
    if (!(error instanceof PlexBindingProtection)) {
      throw error;
    }
    return { status: "protected" as const, reason: error.reason };
  }
}
