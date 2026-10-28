import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import type { RemovalEntry } from "#automation/files/types.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  MovieQuarantinePlexReceiptV2Schema,
  type MovieQuarantinePlexReceiptV2,
} from "#shared/movie-editions/quarantine-v2.ts";
import { RetentionPlexProjectionV1Schema } from "#shared/plex-binding/watch.ts";
import type {
  PlexAccess,
  PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  readCurrentPlexBinding,
  readPlexPhysicalGroup,
} from "#infrastructure/plex-binding/read.ts";
import {
  parsePlexRecord,
  readPlexPointer,
} from "#infrastructure/plex-binding/records.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  movieQuarantineAuthority,
  movieQuarantineManifest,
  assertNoMovieQuarantineReceipt,
} from "./quarantine-authority.ts";

export type MovieQuarantineCommitExpected = {
  commandHash: string;
  manifest: { assets: RemovalEntry[] };
  receipt: Omit<MovieQuarantinePlexReceiptV2, "committedAt">;
  /** Process-local caller capability, never part of a stored receipt or hash. */
  readonly budget: PublicationAuthorityReadBudget;
};

/** Caller owns final physical locks; capture before the first quarantine syscall. */
export async function captureMovieQuarantineCommit(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    decisionId: string;
    scope: MovieEditionScope;
    plan: RemovalEntry[];
    access: readonly PlexAccess[];
    budget: PublicationAuthorityReadBudget;
  },
  freshness: PlexBindingFreshness,
): Promise<MovieQuarantineCommitExpected> {
  freshness.assertActive();
  const { manifest, entry, access } = movieQuarantineManifest(input);
  const { operation, decision, epoch } = await movieQuarantineAuthority(
    tx,
    input,
    input.budget,
  );
  freshness.assertActive();
  assertNoMovieQuarantineReceipt(operation.result);
  if (
    decision.state !== "grace_period" ||
    decision.plexProjection === null ||
    identityHash(decision.manifest) !== identityHash(manifest) ||
    identityHash(entry.generations) !==
      identityHash({ [input.scope.mediaId]: decision.generation })
  )
    throw new PlexBindingProtection("scope_changed");
  const { asset, group } = await readPlexPhysicalGroup(tx, entry.assetId);
  input.budget.consume(1 + asset.coverage.length);
  freshness.assertActive();
  if (
    asset.state !== "published" ||
    group.assetVersion !== entry.assetVersion ||
    group.checksum !== entry.checksum ||
    group.canonicalPath !==
      path.posix.join(CAPACITY_ROOTS.movies, entry.libraryPath)
  )
    throw new PlexBindingProtection("ownership_changed");
  const current = await readCurrentPlexBinding(
    tx,
    {
      scope: { mediaId: input.scope.mediaId, edition: input.scope.edition },
      assetId: entry.assetId,
      access,
    },
    input.budget,
  );
  freshness.assertActive();
  if (current.status !== "current")
    throw new PlexBindingProtection(current.reason);
  if (
    current.association.schemaVersion !== 2 ||
    identityHash(current.association.group) !== identityHash(group)
  )
    throw new PlexBindingProtection("binding_changed");
  const projection = parsePlexRecord(
    RetentionPlexProjectionV1Schema,
    decision.plexProjection.projection,
    decision.plexProjection.projectionHash,
  );
  if (
    projection.decisionId !== decision.id ||
    identityHash(projection.bindings) !== identityHash([current.snapshot]) ||
    identityHash(projection.groupHashes) !== identityHash([identityHash(group)])
  )
    throw new PlexBindingProtection("binding_changed");
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse({
    schemaVersion: 2,
    scope: input.scope,
    operationId: operation.id,
    decisionId: decision.id,
    recoveryEpoch: epoch,
    manifestHash: identityHash(manifest),
    decisions: [
      {
        decisionId: decision.id,
        mediaId: decision.mediaId,
        beforeVersion: decision.version,
        quarantinedVersion: decision.version + 1,
        projectionHash: decision.plexProjection.projectionHash,
      },
    ],
    groups: [group],
    bindings: [current.snapshot],
    committedAt: new Date().toISOString(),
  });
  const { committedAt: _time, ...expected } = receipt;
  freshness.assertActive();
  return {
    commandHash: identityHash(operation.payload),
    manifest,
    receipt: expected,
    budget: input.budget,
  };
}

/** After actual physical/DB transitions, before pointer retirement or availability mirroring. */
export async function recordMovieQuarantineCommit(
  tx: Prisma.TransactionClient,
  expected: MovieQuarantineCommitExpected,
  freshness: PlexBindingFreshness,
): Promise<MovieQuarantinePlexReceiptV2> {
  freshness.assertActive();
  const { operation, decision } = await movieQuarantineAuthority(
    tx,
    expected.receipt,
    expected.budget,
  );
  freshness.assertActive();
  assertNoMovieQuarantineReceipt(operation.result);
  const original = expected.receipt.decisions[0];
  const group = expected.receipt.groups[0];
  if (
    identityHash(operation.payload) !== expected.commandHash ||
    identityHash(expected.manifest) !== expected.receipt.manifestHash ||
    decision.state !== "quarantined" ||
    decision.version !== original.quarantinedVersion ||
    decision.plexProjection?.projectionHash !== original.projectionHash ||
    identityHash(decision.manifest) !== expected.receipt.manifestHash ||
    decision.quarantinedAt === null ||
    decision.quarantinedAt.getTime() > Date.now() ||
    decision.purgeAfter?.getTime() !==
      decision.quarantinedAt.getTime() + 7 * 86_400_000
  )
    throw new PlexBindingProtection("scope_changed");
  const physical = await readPlexPhysicalGroup(tx, group.assetId);
  expected.budget.consume(1 + physical.asset.coverage.length);
  const pointer = await readPlexPointer(
    tx,
    {
      mediaId: expected.receipt.scope.mediaId,
      edition: expected.receipt.scope.edition,
    },
    expected.budget,
  );
  freshness.assertActive();
  if (
    physical.asset.state !== "quarantined" ||
    identityHash(physical.group) !==
      identityHash({ ...group, assetVersion: group.assetVersion + 1 }) ||
    pointer.current?.association.schemaVersion !== 2 ||
    identityHash(pointer.current.snapshot) !==
      identityHash(expected.receipt.bindings[0]) ||
    identityHash(pointer.current.association.group) !== identityHash(group)
  )
    throw new PlexBindingProtection("ownership_changed");
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse({
    ...expected.receipt,
    committedAt: decision.quarantinedAt.toISOString(),
  });
  await bindPlexTransactionDeadline(tx, freshness);
  const written =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('movieQuarantinePlexReceiptV2',${JSON.stringify(receipt)}::jsonb)
    WHERE id=${operation.id} AND NOT (COALESCE(result,'{}'::jsonb) ? 'movieQuarantinePlexReceiptV2')`;
  if (written !== 1) throw new PlexBindingProtection("scope_changed");
  freshness.assertActive();
  return receipt;
}
