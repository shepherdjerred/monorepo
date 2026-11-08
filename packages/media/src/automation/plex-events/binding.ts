import type { Prisma } from "#generated/prisma/client.ts";
import type {
  PlexAccess,
  PlexAssociation,
} from "#shared/plex-binding/contract.ts";
import type { BoundWatchAuthority } from "#shared/plex-binding/watch.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import {
  captureQuarantinedPlexWatchScope,
  assertQuarantinedPlexWatchScope,
  readQuarantinedPlexWatchAuthority,
  type QuarantinedPlexWatchScope,
} from "#infrastructure/plex-binding/quarantine.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertCapturedMovieQuarantinedPlexWatchScope } from "#infrastructure/movie-editions/retention/quarantine-watch.ts";

export type WatchBindingScope = {
  mediaId: string;
  edition?: MovieEditionKey;
  access: PlexAccess;
  mediaIds: string[];
  assetIds: string[];
  quarantine: QuarantinedPlexWatchScope | null;
};
export type WatchBinding = {
  authority: BoundWatchAuthority;
  association: PlexAssociation;
};

/** Discover complete physical and receipt membership before any root is locked. */
export async function captureWatchBindingScope(
  tx: Prisma.TransactionClient,
  mediaId: string,
  access: PlexAccess,
  options:
    | MovieEditionKey
    | {
        edition?: MovieEditionKey | undefined;
        budget?: PublicationAuthorityReadBudget | undefined;
      } = "default",
): Promise<WatchBindingScope | null> {
  const { edition = "default", budget } =
    typeof options === "string" ? { edition: options } : options;
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId, edition, current: true },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
  if (coverage.length !== 1) return null;
  const selected = coverage[0];
  if (selected === undefined)
    throw new Error("Watch physical scope omitted its selected row");
  if (selected.asset.state === "quarantined") {
    const decisions = await tx.retentionDecision.findMany({
      where: { mediaId, edition, state: "quarantined" },
      take: 2,
    });
    budget?.consume(decisions.length);
    if (decisions.length !== 1 || decisions[0] === undefined) return null;
    const captured = await captureQuarantinedPlexWatchScope(
      tx,
      {
        decisionId: decisions[0].id,
        scope: { mediaId, edition },
        assetId: selected.assetId,
        access,
      },
      budget,
    );
    if (captured.status !== "current") return null;
    return {
      mediaId,
      ...(edition === "default" ? {} : { edition }),
      access,
      mediaIds: captured.scope.mediaIds,
      assetIds: captured.scope.assetIds,
      quarantine: captured.scope,
    };
  }
  if (
    selected.asset.state !== "published" ||
    selected.asset.coverage.some((row) => row.edition !== edition)
  )
    return null;
  const mediaIds = selected.asset.coverage.map((row) => row.mediaId).sort();
  if (mediaIds.length === 0 || mediaIds.length > 10_000) return null;
  return {
    mediaId,
    ...(edition === "default" ? {} : { edition }),
    access,
    mediaIds,
    assetIds: [selected.assetId],
    quarantine: null,
  };
}

/** The caller already holds the entire captured root/identity/asset union. */
export async function readWatchBinding(
  tx: Prisma.TransactionClient,
  scope: WatchBindingScope,
  budget?: PublicationAuthorityReadBudget,
): Promise<WatchBinding | null> {
  if (scope.quarantine !== null)
    return readQuarantinedWatchBinding(tx, scope.quarantine, budget);
  const assetId = scope.assetIds[0];
  if (assetId === undefined || scope.assetIds.length !== 1)
    throw new Error(
      "Serving watch scope must have one complete physical group",
    );
  const result = await readCurrentPlexBinding(
    tx,
    {
      scope: { mediaId: scope.mediaId, edition: scope.edition ?? "default" },
      assetId,
      access: scope.access,
    },
    budget,
  );
  if (result.status !== "current") return null;
  if (
    identityHash(
      result.association.group.coverage.map((row) => row.mediaId).sort(),
    ) !== identityHash(scope.mediaIds)
  )
    return null;
  return {
    authority: { purpose: "current_serving", binding: result.snapshot },
    association: result.association,
  };
}

async function readQuarantinedWatchBinding(
  tx: Prisma.TransactionClient,
  scope: QuarantinedPlexWatchScope,
  budget?: PublicationAuthorityReadBudget,
): Promise<WatchBinding | null> {
  try {
    const scoped = "schemaVersion" in scope.authority.quarantine;
    if (!scoped) await assertQuarantinedPlexWatchScope(tx, scope, budget);
    const current = await readQuarantinedPlexWatchAuthority(
      tx,
      scope.input,
      budget,
    );
    if (current.status !== "current") return null;
    if (scoped) assertCapturedMovieQuarantinedPlexWatchScope(scope, current);
    return { authority: current.authority, association: current.association };
  } catch (error) {
    if (error instanceof PlexBindingProtection) return null;
    throw error;
  }
}
