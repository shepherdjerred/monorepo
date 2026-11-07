import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { MovieRollbackOperationV1 } from "#shared/movie-editions/rollback/operation.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { readRequestedMovieRollbackCommandV1 } from "./manual-command-records.ts";
import { captureRequestedMovieRollbackOwnerV1 } from "./manual-context.ts";
import {
  readMovieRollbackIntentV1,
  movieRollbackPhysicalFromIntentV1,
} from "#infrastructure/movie-editions/rollback/records.ts";
import { captureManualMoviePlaybackAdmissionV1 } from "./manual-playback-admission.ts";
import { MovieRollbackHandoffRefV1Schema } from "#shared/movie-editions/rollback/handoff-reference.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import {
  captureMovieRollbackHandoffExecutionV1,
  movieRollbackExecutionFreshnessV1,
  type MovieRollbackHandoffExecutionV1,
} from "#infrastructure/movie-editions/rollback/retry/handoff-execution.ts";

/** Admission verifies current B. After a durable admission, Files may already
 * have inverse ACKs: that phase verifies sessions against admitted identities,
 * without falsely claiming that B's old library bytes still serve. */
export async function captureRequestedMovieRollbackPlaybackV1(
  tx: Prisma.TransactionClient,
  input: {
    input: MovieRollbackOperationV1;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
    handoff?: MovieRollbackHandoffExecutionV1;
  },
) {
  const { invocation } = input;
  if (input.handoff !== undefined) {
    const locked = await lockMovieCommand(tx, input.input.scope);
    invocation.budget.consume(locked.target === null ? 1 : 2);
    await tx.$queryRaw`SELECT o.id FROM "Operation" o WHERE o.id=${input.input.operationId} FOR UPDATE`;
  }
  const command = await readRequestedMovieRollbackCommandV1(
    tx,
    input.input,
    invocation.budget,
  );
  const admitted = await readMovieRollbackIntentV1(
    tx,
    { mode: "manual_verified", command: input.input, source: command.source },
    invocation.budget,
  );
  if (admitted !== null && movieRollbackPhysicalFromIntentV1(admitted) !== null)
    return { status: "complete" as const };
  const owner =
    admitted === null
      ? undefined
      : z
          .object({
            movieRollbackOwnerV1: MovieRollbackHandoffRefV1Schema.optional(),
          })
          .nullable()
          .parse(admitted.operation.result)?.movieRollbackOwnerV1;
  if (owner !== undefined && input.handoff === undefined)
    throw new FileGuardError("movie_rollback_execution_owner_changed");
  const captured =
    admitted === null
      ? await captureAdmission(tx, input, command)
      : await capturePhysical(tx, input, command, admitted);
  const handoff =
    admitted === null
      ? null
      : await captureMovieRollbackHandoffExecutionV1(tx, admitted, {
          ...(input.handoff === undefined ? {} : { handoff: input.handoff }),
          invocation,
          access: input.access,
          phase: "playback",
        });
  const currentFreshness = movieRollbackExecutionFreshnessV1(
    invocation,
    captured.freshness,
    handoff,
  );
  const writer = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  invocation.budget.consume(1);
  if (
    writer.revokedAt !== null ||
    writer.recoveryEpoch !== command.expected.recoveryEpoch ||
    writer.observedAt.getTime() > Date.now()
  )
    throw new FileGuardError("runtime_protected");
  const freshness = plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs: Math.min(
      invocation.execution.expiresAtMs,
      currentFreshness.expiresAtMs,
      writer.expiresAt.getTime(),
      admitted === null
        ? Date.parse(command.expected.cleanup.expiresAt)
        : Number.POSITIVE_INFINITY,
    ),
    guards: [invocation.execution, currentFreshness],
  });
  return {
    status: "captured" as const,
    command,
    ...captured,
    freshness,
    writerExpiresAtMs: writer.expiresAt.getTime(),
    handoff,
  };
}

type Input = Parameters<typeof captureRequestedMovieRollbackPlaybackV1>[1];
type Command = Awaited<ReturnType<typeof readRequestedMovieRollbackCommandV1>>;
type Admission = NonNullable<
  Awaited<ReturnType<typeof readMovieRollbackIntentV1>>
>;

async function captureAdmission(
  tx: Prisma.TransactionClient,
  input: Input,
  command: Command,
) {
  const captured = await captureManualMoviePlaybackAdmissionV1(tx, {
    command,
    access: input.access,
    invocation: input.invocation,
  });
  const association = PlexMovieAssociationV2Schema.parse(
    captured.binding.association,
  );
  const canonicalTargets = await readPlexCanonicalTargets(tx, [
    association.scope,
  ]);
  input.invocation.budget.consume(canonicalTargets.length);
  const canonical = canonicalTargets[0];
  if (
    canonical?.kind !== "movie" ||
    canonical.canonicalRootId !== input.input.scope.rootMediaId
  )
    throw new FileGuardError("movie_rollback_review_changed");
  const expected = PlexBindingExpectedSchema.parse({
    schemaVersion: 1,
    recoveryEpoch: command.expected.recoveryEpoch,
    access: [association.access],
    targets: [
      {
        scope: association.scope,
        editionRootId: input.input.scope.rootMediaId,
        mediaVersion: captured.authority.media.version,
        intentVersion: captured.authority.target.version,
        generation: captured.authority.target.generation,
        automationEpoch: captured.authority.target.automationEpoch,
        definition: association.definition,
        canonicalIdentityHash: canonical.canonicalIdentityHash,
        numberingHash: canonical.numberingHash,
      },
    ],
    previous: [
      {
        scope: association.scope,
        revision: captured.binding.snapshot.revision,
        evidence: {
          id: captured.binding.snapshot.evidenceId,
          associationHash: captured.binding.snapshot.associationHash,
        },
      },
    ],
    oldGroups: [association.group],
    newGroups: [association.group],
    parents: [
      {
        kind: "acquisition",
        attemptId: captured.published.attempt.id,
        operationId: captured.published.attempt.operationId,
        planHash: captured.published.reference.intent.filePlanHash,
        identityHash: identityHash(captured.published.attempt.identityEvidence),
        recoveryEpoch: command.expected.recoveryEpoch,
        generations: captured.published.attempt.generations,
      },
    ],
  });
  const original = captured.published.reference.intent.entries[0].predecessor;
  if (original === null)
    throw new Error("Requested movie rollback lost its original predecessor");
  return {
    phase: "admission" as const,
    admission: null,
    expected,
    canonicalTargets,
    association,
    binding: captured.binding.snapshot,
    paths: rollbackPlaybackPaths(
      [captured.predecessor, captured.successor, original],
      association,
    ),
    freshness: captured.authority.freshness,
    captionCount:
      captured.predecessor.subtitles.length +
      captured.predecessor.subtitleHistory.length +
      captured.successor.subtitles.length +
      captured.successor.subtitleHistory.length,
  };
}

async function capturePhysical(
  tx: Prisma.TransactionClient,
  input: Input,
  command: Command,
  admitted: Admission,
) {
  const authority = await captureRequestedMovieRollbackOwnerV1(tx, {
    actorId: command.payload.actorId,
    scope: input.input.scope,
    access: input.access,
    invocation: input.invocation,
    expected: command.expected,
    phase: "physical",
  });
  if (identityHash(input.access) !== identityHash(admitted.intent.access))
    throw new FileGuardError("wrong_section");
  const ids = [
    admitted.intent.predecessor.id,
    admitted.intent.successor.id,
  ].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT a.id FROM "LibraryAsset" a WHERE a.id IN (${Prisma.join(ids)}) ORDER BY a.id FOR UPDATE`,
  );
  const predecessor = await snapshotMoviePublicationAssetV2(
    tx,
    input.input.scope,
    admitted.intent.predecessor.id,
    input.invocation.budget,
  );
  const successor = await snapshotMoviePublicationAssetV2(
    tx,
    input.input.scope,
    admitted.intent.successor.id,
    input.invocation.budget,
  );
  const pointer = await readPlexPointer(
    tx,
    { mediaId: input.input.scope.mediaId, edition: input.input.scope.edition },
    input.invocation.budget,
  );
  if (
    identityHash(predecessor) !== identityHash(admitted.intent.predecessor) ||
    identityHash(successor) !== identityHash(admitted.intent.successor) ||
    identityHash(pointer.expected) !== identityHash(admitted.intent.pointer) ||
    pointer.current === null
  )
    throw new FileGuardError("movie_rollback_pair_changed");
  const association = PlexMovieAssociationV2Schema.parse(
    pointer.current.association,
  );
  const original =
    admitted.intent.source.reference.intent.entries[0].predecessor;
  if (original === null)
    throw new Error("Requested movie rollback lost its original predecessor");
  const manifest = admitted.intent.captionManifest;
  const rollbackDirectory = predecessor.path.slice(
    0,
    predecessor.path.lastIndexOf("/") + 1,
  );
  if (manifest === undefined || !rollbackDirectory.endsWith("/rollback/"))
    throw new FileGuardError("movie_rollback_pair_changed");
  const controlDirectory = rollbackDirectory.slice(0, -"rollback/".length);
  const paths = [
    ...new Set([
      ...rollbackPlaybackPaths([predecessor, successor, original], association),
      ...manifest.captions.map((caption) => caption.storedTargetPath),
      `${controlDirectory}rollback/recover-${successor.id}`,
      `${controlDirectory}staging/recover-${successor.id}`,
    ]),
  ].sort();
  return {
    phase: "physical" as const,
    admission: {
      intentId: admitted.intent.id,
      intentHash: admitted.intentHash,
    },
    expected: null,
    canonicalTargets: [],
    association,
    binding: pointer.current.snapshot,
    paths,
    freshness: authority.freshness,
    captionCount:
      predecessor.subtitles.length +
      predecessor.subtitleHistory.length +
      successor.subtitles.length +
      successor.subtitleHistory.length,
  };
}

function rollbackPlaybackPaths(
  assets: readonly Awaited<
    ReturnType<typeof snapshotMoviePublicationAssetV2>
  >[],
  association: ReturnType<typeof PlexMovieAssociationV2Schema.parse>,
) {
  return [
    ...new Set([
      ...assets.flatMap((asset) => [
        asset.path,
        ...[...asset.subtitles, ...asset.subtitleHistory].flatMap((caption) =>
          caption.path === null ? [] : [caption.path],
        ),
      ]),
      ...association.item.media.flatMap((media) =>
        media.parts.map((part) => part.file),
      ),
    ]),
  ].sort();
}
