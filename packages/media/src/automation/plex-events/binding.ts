import type { Prisma } from "#generated/prisma/client.ts";
import type {
  PlexAccess,
  PlexAssociationV1,
} from "#shared/plex-binding/contract.ts";
import type { BoundWatchAuthority } from "#shared/plex-binding/watch.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import {
  captureQuarantinedPlexWatchScope,
  assertQuarantinedPlexWatchScope,
  readQuarantinedPlexWatchAuthority,
  type QuarantinedPlexWatchScope,
} from "#infrastructure/plex-binding/quarantine.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

export type WatchBindingScope = {
  mediaId: string;
  access: PlexAccess;
  mediaIds: string[];
  assetIds: string[];
  quarantine: QuarantinedPlexWatchScope | null;
};
export type WatchBinding = {
  authority: BoundWatchAuthority;
  association: PlexAssociationV1;
};

/** Discover complete physical and receipt membership before any root is locked. */
export async function captureWatchBindingScope(
  tx: Prisma.TransactionClient,
  mediaId: string,
  access: PlexAccess,
): Promise<WatchBindingScope | null> {
  const coverage = await tx.assetCoverage.findMany({
    where: { ...defaultScope(mediaId), current: true },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
  if (coverage.length !== 1) return null;
  const selected = coverage[0];
  if (selected === undefined)
    throw new Error("Watch physical scope omitted its selected row");
  if (selected.asset.state === "quarantined") {
    const decisions = await tx.retentionDecision.findMany({
      where: { ...defaultScope(mediaId), state: "quarantined" },
      take: 2,
    });
    if (decisions.length !== 1 || decisions[0] === undefined) return null;
    const captured = await captureQuarantinedPlexWatchScope(tx, {
      decisionId: decisions[0].id,
      scope: defaultScope(mediaId),
      assetId: selected.assetId,
      access,
    });
    if (captured.status !== "current") return null;
    return {
      mediaId,
      access,
      mediaIds: captured.scope.mediaIds,
      assetIds: captured.scope.assetIds,
      quarantine: captured.scope,
    };
  }
  if (
    selected.asset.state !== "published" ||
    selected.asset.coverage.some((row) => row.edition !== "default")
  )
    return null;
  const mediaIds = selected.asset.coverage.map((row) => row.mediaId).sort();
  if (mediaIds.length === 0 || mediaIds.length > 10_000) return null;
  return {
    mediaId,
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
): Promise<WatchBinding | null> {
  if (scope.quarantine !== null) {
    try {
      await assertQuarantinedPlexWatchScope(tx, scope.quarantine);
      const current = await readQuarantinedPlexWatchAuthority(
        tx,
        scope.quarantine.input,
      );
      return current.status === "current"
        ? { authority: current.authority, association: current.association }
        : null;
    } catch (error) {
      if (error instanceof PlexBindingProtection) return null;
      throw error;
    }
  }
  const assetId = scope.assetIds[0];
  if (assetId === undefined || scope.assetIds.length !== 1)
    throw new Error(
      "Serving watch scope must have one complete physical group",
    );
  const result = await readCurrentPlexBinding(tx, {
    scope: defaultScope(scope.mediaId),
    assetId,
    access: scope.access,
  });
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
