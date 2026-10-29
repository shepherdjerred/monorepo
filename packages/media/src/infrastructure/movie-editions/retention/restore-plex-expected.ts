import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import { MovieRestorePlexExpectedV1Schema } from "#shared/movie-editions/restore-plex-v1.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoMediaSubtitleReplacement } from "#automation/files/guards.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { readMovieRestoreCommand } from "./restore-source.ts";
import { readMovieRestorePublicationParentV1 } from "#infrastructure/movie-editions/publication/restore-records.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import { readPlexDefinition } from "#infrastructure/plex-binding/read.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { captureMovieRestorePlexDemand } from "./restore-plex-demand.ts";
import {
  readMovieRestoreOriginalItem,
  assertMovieRestoreOriginalAccess,
} from "./restore-plex-identity.ts";

/** Complete current scope is recaptured under the same locks before a verified binding can commit. */
export async function captureMovieRestorePlexExpectedV1(
  tx: Prisma.TransactionClient,
  input: {
    command: MovieOperationV4;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
  },
) {
  const { command, access, invocation } = input;
  invocation.execution.assertActive();
  const { media, target } = await lockMovieCommand(tx, command.scope);
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${command.operationId} FOR UPDATE`;
  const { operation, command: stored } = await readMovieRestoreCommand(
    tx,
    command,
    invocation.budget,
  );
  const parent = await readMovieRestorePublicationParentV1(
    tx,
    operation,
    invocation.budget,
  );
  const epoch = parent.asset.ownershipEpoch;
  if (
    target?.availability !== "importing" ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null ||
    target.generation !== command.generation ||
    target.automationEpoch !== epoch ||
    stored.recoveryEpoch !== epoch ||
    !(await lockRuntimeAuthority(tx, epoch))
  )
    throw new PlexBindingProtection("ownership_changed");
  const demand = await captureMovieRestorePlexDemand(
    tx,
    { receipt: parent.receipt, target, access },
    invocation,
  );
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${parent.asset.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT "assetId" FROM "AssetCoverage" WHERE "assetId"=${parent.asset.id} ORDER BY "mediaId",edition FOR UPDATE`;
  await assertPublicationUnfenced(tx, [command.mediaId], [parent.asset.id]);
  await assertNoMediaSubtitleReplacement(tx, [command.mediaId]);
  await assertLegacyClaimsResolved(tx, [command.mediaId]);
  if (
    await tx.recoveryHold.count({
      where: {
        mediaId: command.mediaId,
        edition: command.scope.edition,
        releasedAt: null,
      },
    })
  )
    throw new PlexBindingProtection("ownership_changed");
  const asset = await snapshotMoviePublicationAssetV2(
    tx,
    command.scope,
    parent.asset.id,
    invocation.budget,
  );
  if (identityHash(asset) !== identityHash(parent.asset))
    throw new PlexBindingProtection("ownership_changed");
  const scope = { mediaId: command.mediaId, edition: command.scope.edition };
  const pointer = await readPlexPointer(tx, scope, invocation.budget);
  const quarantine = await tx.operation.findUniqueOrThrow({
    where: { id: parent.receipt.quarantine.operationId },
  });
  invocation.budget.consume(1);
  // The physical receipt reader has already validated this literal immutable quarantine parent.
  const original = MovieQuarantinePlexReceiptV2Schema.parse(
    z
      .object({ movieQuarantinePlexReceiptV2: z.json() })
      .parse(quarantine.result).movieQuarantinePlexReceiptV2,
  );
  if (
    identityHash(original) !== parent.receipt.quarantine.receiptHash ||
    pointer.current !== null ||
    pointer.expected.revision !== original.bindings[0].revision + 1
  )
    throw new PlexBindingProtection("binding_changed");
  const canonicalTargets = await readPlexCanonicalTargets(tx, [scope]);
  const canonical = canonicalTargets[0];
  if (
    canonical?.kind !== "movie" ||
    canonical.canonicalRootId !== command.scope.rootMediaId
  )
    throw new PlexBindingProtection("scope_changed");
  const definition = await readPlexDefinition(
    tx,
    scope,
    command.scope.rootMediaId,
  );
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const originalItem = await readMovieRestoreOriginalItem(
    tx,
    original,
    invocation.budget,
  );
  assertMovieRestoreOriginalAccess(access, originalItem.access);
  const expected = MovieRestorePlexExpectedV1Schema.parse({
    schemaVersion: 3,
    originalItem: originalItem.item,
    recoveryEpoch: epoch,
    access: [
      {
        serverMachineId: access.serverMachineId,
        sectionId: access.movieSectionId,
        sectionType: "movie",
      },
    ],
    targets: [
      {
        scope,
        editionRootId: command.scope.rootMediaId,
        mediaVersion: media.version,
        intentVersion: target.version,
        generation: target.generation,
        automationEpoch: target.automationEpoch,
        definition,
        canonicalIdentityHash: canonical.canonicalIdentityHash,
        numberingHash: canonical.numberingHash,
      },
    ],
    previous: [pointer.expected],
    oldGroups: [],
    newGroups: [
      {
        assetId: asset.id,
        assetVersion: asset.version,
        checksum: asset.checksum,
        sizeBytes: asset.sizeBytes,
        canonicalPath: asset.path,
        ownershipEpoch: epoch,
        canonicalRootId: command.scope.rootMediaId,
        edition: command.scope.edition,
        coverage: [scope],
        coverageHash: identityHash([scope]),
      },
    ],
    parents: [
      {
        kind: "movie_restore_publication_v1",
        recoveryEpoch: epoch,
        reference: parent.reference,
      },
    ],
  });
  const freshness = plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs: Math.min(
      invocation.execution.expiresAtMs,
      lease.expiresAt.getTime(),
      demand.expiresAtMs,
    ),
    guards: [invocation.execution, demand],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  return {
    expected,
    parent,
    asset,
    operation,
    canonicalTargets,
    freshness,
    writerExpiresAtMs: lease.expiresAt.getTime(),
  };
}
