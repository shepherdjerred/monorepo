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

export async function queueExistingPlexBinding(
  context: MediaAutomationContext,
  assetId: string,
) {
  const execution = context.plexBindingExecution();
  const { observed, expiresAtMs } = execution;
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
    freshness.assertActive();
    if (
      coverage.length === 0 ||
      coverage.some(
        (value) =>
          value.edition !== "default" ||
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
      const expected = await captureExistingPlexBindingExpected(tx, {
        assetIds: [assetId],
        access,
      });
      const scope = await preparePlexBindingLockScope(tx, expected);
      await lockPlexBindingScope(tx, scope, freshness);
      const queued = await queuePlexBindingReverification(tx, {
        expected,
        renewalBucket: Math.floor(observed.wall / 3_600_000),
      });
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
