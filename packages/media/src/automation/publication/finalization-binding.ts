import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { bindingAccess } from "#automation/plex-binding/access.ts";
import { captureExistingPlexBindingExpected } from "#infrastructure/plex-binding/cold.ts";
import {
  preparePlexBindingLockScope,
  lockPlexBindingScope,
} from "#infrastructure/plex-binding/authority.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

/** Finalization consumes existing complete associations; it cannot mint a network proof. */
export async function prepareFinalizationBinding(
  context: MediaAutomationContext,
  mediaIds: readonly string[],
) {
  const execution = context.plexBindingExecution();
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [execution],
  });
  const media = await context.db.mediaItem.findMany({
    where: { id: { in: [...mediaIds] } },
    select: { kind: true },
  });
  if (
    media.length !== mediaIds.length ||
    media.some((row) => row.kind !== "movie" && row.kind !== "episode")
  )
    throw new PlexBindingProtection("scope_changed");
  const access = await bindingAccess(
    context,
    media.map((row) => (row.kind === "movie" ? "movie" : "show")),
  );
  freshness.assertActive();
  const scope = await context.db.$transaction(async (tx) => {
    const coverage = await tx.assetCoverage.findMany({
      where: {
        mediaId: { in: [...mediaIds] },
        current: true,
        edition: "default",
      },
    });
    const expected = await captureExistingPlexBindingExpected(tx, {
      assetIds: [...new Set(coverage.map((row) => row.assetId))].sort(),
      access,
    });
    return preparePlexBindingLockScope(tx, expected);
  });
  freshness.assertActive();
  return { scope, freshness, access };
}

export async function lockFinalizationBinding(
  tx: Prisma.TransactionClient,
  prepared: Awaited<ReturnType<typeof prepareFinalizationBinding>>,
) {
  await lockPlexBindingScope(tx, prepared.scope, prepared.freshness);
  const reads = prepared.scope.expected.newGroups.flatMap((group) =>
    group.coverage.map((scope) => {
      const kind = group.canonicalRootId === scope.mediaId ? "movie" : "show";
      const access = prepared.access.find(
        (value) => value.sectionType === kind,
      );
      if (access === undefined)
        throw new PlexBindingProtection("wrong_section");
      return { scope, assetId: group.assetId, access };
    }),
  );
  const bindings = await readCurrentPlexBindings(tx, reads);
  prepared.freshness.assertActive();
  for (const binding of bindings)
    if (binding.status !== "current")
      throw new PlexBindingProtection(binding.reason);
}
