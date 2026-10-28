import { z } from "zod";
import path from "node:path";
import type { Prisma, Operation } from "#generated/prisma/client.ts";
import { FileGuardError, RemovalPlanSchema } from "#automation/files/types.ts";
import type { FileContext } from "#automation/files/types.ts";
import { fileOperations } from "#automation/files/file-operations.ts";
import type { MovieRemovalScope } from "#automation/files/movie-editions/removal-scope.ts";
import type { MovieDecisionOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import {
  MovieQuarantinePlexReceiptV2Schema,
  type MovieQuarantinePlexReceiptV2,
} from "#shared/movie-editions/quarantine-v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { safePath, exists } from "#filesystem/operations-io.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";

/** Literal parents only: terminal acknowledgement never depends on a newer target generation. */
export async function readMoviePurgeParent(
  tx: Prisma.TransactionClient,
  input: MovieDecisionOperationV4,
  movie: MovieRemovalScope,
) {
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  movie.budget.consume(1);
  const birth = moviePurgeCommand(command, input);
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
  });
  movie.budget.consume(1);
  const parents = await tx.operation.findMany({
    where: {
      kind: "retain_movie_edition_v4",
      result: {
        path: ["movieQuarantinePlexReceiptV2", "decisionId"],
        equals: decision.id,
      },
    },
    take: 2,
  });
  movie.budget.consume(parents.length);
  const parent = parents[0];
  if (parent === undefined || parents.length !== 1)
    throw new FileGuardError("reconciliation_required");
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse(
    z.object({ movieQuarantinePlexReceiptV2: z.json() }).parse(parent.result)
      .movieQuarantinePlexReceiptV2,
  );
  const original = moviePurgeCommand(parent, {
    ...input,
    operationId: parent.id,
  });
  if (
    receipt.operationId !== parent.id ||
    receipt.decisionId !== decision.id ||
    identityHash(receipt.scope) !== identityHash(input.scope) ||
    decision.mediaId !== input.scope.mediaId ||
    decision.edition !== input.scope.edition ||
    decision.generation !== birth.generation ||
    original.generation !== birth.generation ||
    receipt.recoveryEpoch !== birth.recoveryEpoch ||
    original.recoveryEpoch !== birth.recoveryEpoch ||
    receipt.committedAt !== decision.quarantinedAt?.toISOString() ||
    decision.purgeAfter?.getTime() !==
      Date.parse(receipt.committedAt) + 7 * 86_400_000 ||
    identityHash(decision.manifest) !== receipt.manifestHash
  )
    throw new FileGuardError("scope_changed");
  const manifest = RemovalPlanSchema.parse(decision.manifest);
  const entry = assertMoviePurgeManifest({
    manifest,
    receipt,
    input,
    generation: birth.generation,
  });
  return {
    command,
    decision,
    receipt,
    manifest,
    entry,
    epoch: birth.recoveryEpoch,
  };
}

function assertMoviePurgeManifest({
  manifest,
  receipt,
  input,
  generation,
}: {
  manifest: z.infer<typeof RemovalPlanSchema>;
  receipt: MovieQuarantinePlexReceiptV2;
  input: MovieDecisionOperationV4;
  generation: number;
}) {
  const entry = manifest.assets[0];
  const group = receipt.groups[0];
  if (
    entry === undefined ||
    manifest.assets.length !== 1 ||
    entry.libraryKind !== "movies" ||
    entry.assetId !== group.assetId ||
    entry.assetVersion !== group.assetVersion ||
    entry.checksum !== group.checksum ||
    identityHash(manifest) !== receipt.manifestHash ||
    identityHash(entry.mediaIds) !== identityHash([input.scope.mediaId]) ||
    identityHash(entry.generations) !==
      identityHash({ [input.scope.mediaId]: generation })
  )
    throw new FileGuardError("scope_changed");
  return entry;
}

export function moviePurgeCommand(
  operation: Operation,
  input: MovieDecisionOperationV4,
) {
  const command = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.literal("retain_movie_edition_v4"),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    operation.id !== input.operationId ||
    command.operationId !== operation.id ||
    operation.kind !== command.kind ||
    operation.targetId !== input.scope.mediaId ||
    command.mediaId !== input.scope.mediaId ||
    identityHash(command.scope) !== identityHash(input.scope)
  )
    throw new FileGuardError("scope_changed");
  return command;
}

/** Actual terminal video/caption records and the named completed purge journals supply the ACK. */
export async function acknowledgeMoviePurge(
  context: FileContext,
  tx: Prisma.TransactionClient,
  input: {
    command: MovieDecisionOperationV4;
    parent: Awaited<ReturnType<typeof readMoviePurgeParent>>;
    movie: MovieRemovalScope;
  },
) {
  const { parent, movie } = input;
  if (parent.decision.state !== "purged") return false;
  const id = z
    .object({ purgeOperationId: z.uuid() })
    .parse(parent.decision.evidence).purgeOperationId;
  const operation = await tx.operation.findUniqueOrThrow({ where: { id } });
  movie.budget.consume(1);
  const birth = moviePurgeCommand(operation, {
    ...input.command,
    operationId: id,
  });
  if (
    birth.generation !== parent.decision.generation ||
    birth.recoveryEpoch !== parent.epoch
  )
    throw new FileGuardError("scope_changed");
  await assertPurgedMovieRecords(tx, parent, movie);
  const operations = fileOperations(context, context.roots.movies, () => {
    throw new Error("Purge acknowledgement cannot authorize another effect");
  });
  for (const file of [...parent.entry.sidecars, parent.entry]) {
    const source = await safePath(
      context.roots.movies.control,
      `quarantine/${file.quarantineId}`,
      true,
    );
    const journal = await operations.readManifest(
      `${id}-purge-${file.quarantineId}`,
    );
    if (
      journal?.kind !== "purge" ||
      journal.operationId !== `${id}-purge-${file.quarantineId}` ||
      journal.phase !== "complete" ||
      journal.source !== source ||
      journal.target !== source ||
      journal.sha256 !== file.checksum ||
      journal.previousSha256 !== null ||
      (await exists(source))
    )
      throw new FileGuardError("purge_journal_changed");
  }
  context.publicationExecution?.().assertActive();
  return true;
}

async function assertPurgedMovieRecords(
  tx: Prisma.TransactionClient,
  parent: Awaited<ReturnType<typeof readMoviePurgeParent>>,
  movie: MovieRemovalScope,
) {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: parent.entry.assetId },
    include: {
      coverage: true,
      subtitles: {
        where: {
          AND: [
            videoSubtitleWhere,
            { state: { in: ["installed", "quarantined", "purged"] } },
          ],
        },
      },
    },
  });
  movie.budget.consume(1 + asset.coverage.length + asset.subtitles.length);
  const group = parent.receipt.groups[0];
  if (
    asset.state !== "purged" ||
    !asset.owned ||
    asset.ownershipEpoch !== parent.epoch ||
    asset.version !== group.assetVersion + 2 ||
    asset.edition !== parent.receipt.scope.edition ||
    asset.editionRootId !== parent.receipt.scope.rootMediaId ||
    asset.path !== group.canonicalPath ||
    asset.checksum !== group.checksum ||
    asset.coverage.length !== 1 ||
    asset.coverage.some(
      (coverage) =>
        coverage.current ||
        coverage.mediaId !== parent.receipt.scope.mediaId ||
        coverage.edition !== parent.receipt.scope.edition,
    )
  )
    throw new FileGuardError("purge_asset_changed");
  if (
    asset.subtitles.some(
      (subtitle) =>
        subtitle.state !== "purged" ||
        subtitle.videoVersion !== asset.version ||
        subtitle.videoChecksum !== asset.checksum ||
        subtitle.ownershipEpoch !== asset.ownershipEpoch,
    )
  )
    throw new FileGuardError("purge_subtitle_changed");
  if (
    asset.subtitles.filter((subtitle) => subtitle.storageKind === "sidecar")
      .length !== parent.entry.sidecars.length
  )
    throw new FileGuardError("purge_subtitle_changed");
  for (const file of parent.entry.sidecars) {
    if (
      !asset.subtitles.some(
        (subtitle) =>
          subtitle.id === file.subtitleId &&
          subtitle.checksum === file.checksum &&
          subtitle.path ===
            path.posix.join(CAPACITY_ROOTS.movies, file.libraryPath),
      )
    )
      throw new FileGuardError("purge_subtitle_changed");
  }
}
