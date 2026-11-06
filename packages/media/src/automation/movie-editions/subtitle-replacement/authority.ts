import { z } from "zod";
import type { Prisma, SubtitleReplacement } from "#generated/prisma/client.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { MovieReplacementSnapshotV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { captureMovieReplacementSnapshotV2 } from "#infrastructure/movie-editions/subtitle-replacement/snapshot.ts";
import { readMovieReplacementSourceV2 } from "#infrastructure/movie-editions/subtitle-replacement/records.ts";
import { replacementSubtitleSnapshot } from "#automation/subtitle-replacement/snapshot.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import {
  resolveHeldMovieRollbackCaptionSourceV1,
  type HeldMovieRollbackCaptionSourceV1,
} from "#infrastructure/movie-editions/subtitle-replacement/rollback-source.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));
const originalDeadlines = new WeakMap<
  object,
  {
    expiresAtMs: number;
    assertActive: () => void;
    scopeHash: string;
  }
>();

export function movieReplacementFreshness(context: FileContext) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error("Movie replacement has no original invocation");
  const original = originalDeadlines.get(invocation);
  return plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs: Math.min(
      invocation.execution.expiresAtMs,
      original?.expiresAtMs ?? Infinity,
    ),
    guards: [
      invocation.execution,
      ...(original === undefined ? [] : [original]),
    ],
  });
}

export function movieReplacementInvocation(initial: FileContext) {
  const execution = requirePublicationExecution(
    initial.movieManagement?.execution ?? initial.publicationExecution?.(),
  );
  return {
    ...publicationInvocation(initial, execution),
    publicationExecution: () => execution,
    movieManagement: {
      execution,
      budget:
        initial.movieManagement?.budget ?? new PublicationAuthorityReadBudget(),
    },
  };
}

/** Current scope is rechecked under selected-cut locks; compensation cannot publish new bytes. */
export async function assertMovieReplacementSnapshotV2(
  tx: Prisma.TransactionClient,
  row: SubtitleReplacement,
  context: FileContext,
  options: {
    compensation: boolean;
    heldRollbackSource?: HeldMovieRollbackCaptionSourceV1;
  },
) {
  const { compensation, ...heldSourceOptions } = options;
  const snapshot = MovieReplacementSnapshotV2Schema.parse(row.snapshot);
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Movie replacement requires its original execution and provenance allowance",
    );
  invocation.execution.assertActive();
  invocation.execution.signal.throwIfAborted();
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(row.coordinatorOperationId) },
  });
  invocation.budget.consume(1);
  const payload = z
    .object({ movieScope: z.json(), replacementId: z.literal(row.id) })
    .parse(command.payload);
  if (
    hash(payload.movieScope) !== hash(snapshot.scope) ||
    command.targetId !== row.id
  )
    throw new FileGuardError("subtitle_replacement_operation_changed");
  if (compensation) {
    await assertMovieReplacementCompensation(
      tx,
      row,
      context,
      options.heldRollbackSource,
    );
  } else {
    if (!(await context.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    const access = requireMovieChoiceAccess(
      (await fileMovieAccess(context, [snapshot.scope.mediaId])) ?? {},
    );
    const current = await captureMovieReplacementSnapshotV2(
      tx,
      {
        scope: snapshot.scope,
        assetId: row.assetId,
        oldSubtitleId: row.oldSubtitleId,
        candidateSubtitleId: row.candidateSubtitleId,
        epoch: row.recoveryEpoch,
      },
      {
        access,
        budget: invocation.budget,
        ...heldSourceOptions,
      },
    );
    if (hash(current.snapshot) !== row.snapshotHash)
      throw new FileGuardError("subtitle_replacement_snapshot_changed");
    const original = originalDeadlines.get(invocation);
    if (original === undefined)
      originalDeadlines.set(invocation, {
        ...current.freshness,
        scopeHash: hash(snapshot.scope),
      });
    else {
      if (original.scopeHash !== hash(snapshot.scope))
        throw new Error("Movie caption deadline belongs to another scope");
      original.assertActive();
    }
    current.freshness.assertActive();
  }
  invocation.execution.assertActive();
  return snapshot;
}

async function assertMovieReplacementCompensation(
  tx: Prisma.TransactionClient,
  row: SubtitleReplacement,
  context: FileContext,
  heldRollbackSource?: HeldMovieRollbackCaptionSourceV1,
) {
  const snapshot = MovieReplacementSnapshotV2Schema.parse(row.snapshot);
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error("Movie compensation has no original invocation");
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: row.assetId },
    include: { coverage: { where: { current: true }, take: 2 } },
  });
  const old = await tx.subtitleAsset.findUniqueOrThrow({
    where: { id: row.oldSubtitleId },
  });
  const candidate = await tx.subtitleAsset.findUniqueOrThrow({
    where: { id: row.candidateSubtitleId },
  });
  if (
    !asset.owned ||
    asset.state !== "published" ||
    asset.version !== snapshot.asset.version ||
    asset.checksum !== snapshot.asset.checksum ||
    asset.path !== snapshot.asset.path ||
    asset.ownershipEpoch !== row.recoveryEpoch ||
    asset.edition !== snapshot.scope.edition ||
    asset.editionRootId !== snapshot.scope.rootMediaId ||
    asset.coverage.length !== 1 ||
    asset.coverage[0]?.mediaId !== snapshot.scope.mediaId ||
    asset.coverage[0].edition !== snapshot.scope.edition ||
    hash(replacementSubtitleSnapshot(old)) !== hash(snapshot.old) ||
    hash(replacementSubtitleSnapshot(candidate)) !== hash(snapshot.candidate)
  )
    throw new FileGuardError("subtitle_replacement_compensation_changed");
  if (heldRollbackSource !== undefined) {
    resolveHeldMovieRollbackCaptionSourceV1(
      tx,
      {
        scope: snapshot.scope,
        asset,
        old: NativeSubtitleSnapshotSchema.parse(snapshot.old),
      },
      { budget: invocation.budget, source: heldRollbackSource },
    );
    return;
  }
  await readMovieReplacementSourceV2(
    tx,
    {
      source: snapshot.source,
      scope: snapshot.scope,
      old: NativeSubtitleSnapshotSchema.parse(snapshot.old),
    },
    invocation.budget,
  );
}
