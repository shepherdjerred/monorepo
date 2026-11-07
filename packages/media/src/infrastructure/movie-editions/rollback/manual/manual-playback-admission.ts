import { z } from "zod";
import { Prisma, type UpgradeCleanup } from "#generated/prisma/client.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { MoviePlexReceiptSchema } from "#shared/movie-editions/management/plex.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { assertMovieAcquisitionOperationV4 } from "#infrastructure/movie-editions/lifecycle/operation.ts";
import {
  moviePlexAttemptParentV2,
  moviePlexCommandParentV2,
} from "#infrastructure/movie-editions/plex/receipt.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { captureRequestedMovieRollbackOwnerV1 } from "./manual-context.ts";
import type { readRequestedMovieRollbackCommandV1 } from "./manual-command-records.ts";

type Command = Awaited<ReturnType<typeof readRequestedMovieRollbackCommandV1>>;

/** Network playback has its own purpose: actual reviewed pair, current B
 * serving identity, complete affected path census and fresh owner/CAS. Full
 * B-caption installation ancestry belongs to the later real Files admission. */
export async function captureManualMoviePlaybackAdmissionV1(
  tx: Prisma.TransactionClient,
  input: {
    command: Command;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
  },
) {
  const { command, invocation, access } = input;
  const scope = command.source.scope;
  const authority = await captureRequestedMovieRollbackOwnerV1(tx, {
    actorId: command.payload.actorId,
    scope,
    access,
    invocation,
    expected: command.expected,
    phase: "admission",
  });
  const published = await loadMoviePublicationV2(
    tx,
    command.source.attemptId,
    invocation.budget,
  );
  if (
    published?.outcome?.kind !== "published" ||
    published.attempt.state !== "completed" ||
    identityHash(published.reference.intent.scope) !== identityHash(scope)
  )
    throw new FileGuardError("movie_rollback_source_not_published");
  const { originalA, originalB } = playbackSourcePair(
    command,
    published.outcome.entries[0].predecessor,
    published.outcome.entries[0].successor,
  );
  const sourceCommand = await assertMovieAcquisitionOperationV4(
    tx,
    command.source.operationId,
    scope,
    published.attempt.recoveryEpoch,
  );
  invocation.budget.consume(1);
  const serving = z
    .object({
      moviePlexReceiptV2: z.unknown().optional(),
      moviePlexReceiptV3: z.unknown().optional(),
    })
    .nullable()
    .parse(sourceCommand.operation.result);
  const markers = [
    serving?.moviePlexReceiptV2,
    serving?.moviePlexReceiptV3,
  ].filter((marker) => marker !== undefined);
  if (markers.length !== 1)
    throw new Error(
      "Manual playback source lost its one actual successful B receipt",
    );
  const envelope = z
    .strictObject({ receipt: MoviePlexReceiptSchema, receiptHash: z.string() })
    .parse(markers[0]);
  const receipt = parsePlexRecord(
    MoviePlexReceiptSchema,
    envelope.receipt,
    envelope.receiptHash,
  );
  if (
    identityHash(receipt.input) !== identityHash(command.source) ||
    identityHash(receipt.attempt) !==
      identityHash(moviePlexAttemptParentV2(published.attempt)) ||
    identityHash(receipt.command) !==
      identityHash(moviePlexCommandParentV2(sourceCommand.operation)) ||
    receipt.publication.transitionId !== published.reference.transitionId ||
    receipt.publication.intentHash !== published.reference.intentHash ||
    receipt.publication.outcomeHash !== published.outcomeHash
  )
    throw new Error(
      "Manual playback source changed its actual immutable B birth or successful serving parent",
    );
  const ids = [originalA.id, originalB.id].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT a.id FROM "LibraryAsset" a WHERE a.id IN (${Prisma.join(ids)}) ORDER BY a.id FOR UPDATE`,
  );
  const predecessor = await snapshotMoviePublicationAssetV2(
    tx,
    scope,
    originalA.id,
    invocation.budget,
  );
  const successor = await snapshotMoviePublicationAssetV2(
    tx,
    scope,
    originalB.id,
    invocation.budget,
  );
  assertPlaybackPair(command, predecessor, successor);
  const binding = await readCurrentPlexBinding(
    tx,
    {
      scope: { mediaId: scope.mediaId, edition: scope.edition },
      assetId: successor.id,
      access: {
        serverMachineId: access.serverMachineId,
        sectionId: access.movieSectionId,
        sectionType: "movie",
      },
    },
    invocation.budget,
  );
  if (
    binding.status !== "current" ||
    identityHash(binding.snapshot) !== identityHash(command.expected.binding)
  )
    throw new FileGuardError("movie_rollback_binding_changed");
  await tx.$queryRaw`SELECT c.id FROM "UpgradeCleanup" c WHERE c.id=${command.expected.cleanup.id} FOR UPDATE`;
  const cleanup = await tx.upgradeCleanup.findUniqueOrThrow({
    where: { id: command.expected.cleanup.id },
  });
  invocation.budget.consume(1);
  assertPendingPlaybackCleanup({
    command,
    cleanup,
    predecessorId: predecessor.id,
    successorId: successor.id,
    epoch: authority.runtime.recoveryEpoch,
  });
  authority.freshness.assertActive();
  return { authority, published, predecessor, successor, binding, cleanup };
}

function playbackSourcePair(
  command: Command,
  originalA: { id: string } | null,
  originalB: { id: string } | null,
) {
  if (
    originalA === null ||
    originalB === null ||
    originalA.id !== command.expected.predecessor.id ||
    originalB.id !== command.expected.successor.id
  )
    throw new FileGuardError("movie_rollback_pair_changed");
  return { originalA, originalB };
}

function assertPendingPlaybackCleanup(input: {
  command: Command;
  cleanup: UpgradeCleanup;
  predecessorId: string;
  successorId: string;
  epoch: number;
}) {
  const { cleanup, command } = input;
  if (
    cleanup.state !== "pending" ||
    cleanup.version !== command.expected.cleanup.version ||
    cleanup.expiresAt.toISOString() !== command.expected.cleanup.expiresAt ||
    cleanup.assetId !== input.predecessorId ||
    cleanup.successorAssetId !== input.successorId ||
    cleanup.recoveryEpoch !== input.epoch ||
    cleanup.expiresAt.getTime() <= Date.now()
  )
    throw new FileGuardError("movie_rollback_cleanup_changed");
}

function assertPlaybackPair(
  command: Command,
  predecessor: Awaited<ReturnType<typeof snapshotMoviePublicationAssetV2>>,
  successor: Awaited<ReturnType<typeof snapshotMoviePublicationAssetV2>>,
) {
  if (
    predecessor.state !== "superseded" ||
    successor.state !== "published" ||
    predecessor.supersededByAssetId !== successor.id ||
    predecessor.coverage[0].current ||
    !successor.coverage[0].current ||
    predecessor.ownershipEpoch !== command.expected.recoveryEpoch ||
    successor.ownershipEpoch !== command.expected.recoveryEpoch ||
    predecessor.version !== command.expected.predecessor.version ||
    predecessor.checksum !== command.expected.predecessor.checksum ||
    successor.version !== command.expected.successor.version ||
    successor.checksum !== command.expected.successor.checksum
  )
    throw new FileGuardError("movie_rollback_pair_changed");
}
