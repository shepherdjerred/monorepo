import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  MovieRollbackPhysicalV1Schema,
  type MovieRollbackIntentV1,
  type MovieRollbackPhysicalV1,
} from "#shared/movie-editions/rollback/physical.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import { advanceSubtitleBindings } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  retireMovieRollbackBindingV1,
  type captureMovieRollbackBindingV1,
} from "./binding.ts";
import { assertMovieRollbackPhysicalV1 } from "./validation.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { movieRollbackTransactionId } from "./transaction.ts";
import type { MovieRollbackPlaybackV1 } from "#shared/movie-editions/rollback/playback.ts";
import { retainRequestedMovieRollbackCaptionsV1 } from "./manual/manual-captions.ts";

/** Finalization runs inside the causal inverse's path-lock callback and the
 * same held SQL transaction. It advances only the actual admitted pair. */
export async function commitMovieRollbackPhysicalV1(
  tx: Prisma.TransactionClient,
  input: {
    context: PublicationContext;
    intent: MovieRollbackIntentV1;
    freshness: PlexBindingFreshness;
    binding: Awaited<ReturnType<typeof captureMovieRollbackBindingV1>>;
    evidence: Pick<
      MovieRollbackPhysicalV1,
      "effects" | "participants" | "journals" | "successorCaptions"
    >;
    manualPlayback?: {
      reference: NonNullable<MovieRollbackPhysicalV1["playback"]>;
      guard: MovieRollbackPlaybackV1;
    };
  },
) {
  const { context, intent, freshness } = input;
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  const entry = intent.source.reference.intent.entries[0].entry;
  const original = intent.source.reference.intent.entries[0].predecessor;
  if (original === null)
    throw new FileGuardError("movie_rollback_admission_mode_changed");
  freshness.assertActive();
  if (intent.invocation.mode === "manual_verified") {
    const playback = input.manualPlayback;
    if (playback === undefined)
      throw new FileGuardError("movie_rollback_playback_observation_required");
    if (
      playback.guard.phase !== "physical" ||
      playback.guard.admission?.intentId !== intent.id ||
      playback.guard.admission.intentHash !== identityHash(intent) ||
      input.evidence.successorCaptions === undefined
    )
      throw new FileGuardError("movie_rollback_playback_observation_required");
    await retainRequestedMovieRollbackCaptionsV1(tx, intent);
  } else if (
    intent.cleanup !== null ||
    input.manualPlayback !== undefined ||
    input.evidence.successorCaptions !== undefined
  ) {
    throw new FileGuardError("movie_rollback_admission_mode_changed");
  }
  freshness.assertActive();
  await bindPlexTransactionDeadline(tx, freshness);
  await tx.assetCoverage.updateMany({
    where: {
      assetId: intent.successor.id,
      mediaId: intent.scope.mediaId,
      edition: intent.scope.edition,
      current: true,
    },
    data: { current: false },
  });
  await tx.libraryAsset.update({
    where: {
      id: intent.successor.id,
      version: intent.successor.version,
      state: "published",
    },
    data: {
      path: storedFilePath(
        context,
        "movies",
        "control",
        `rollback/recover-${entry.assetId}`,
      ),
      state: "rejected",
      version: { increment: 1 },
    },
  });
  await tx.libraryAsset.update({
    where: {
      id: intent.predecessor.id,
      version: intent.predecessor.version,
      state: "superseded",
    },
    data: {
      path: original.path,
      state: "published",
      supersededByAssetId: null,
      version: { increment: 1 },
    },
  });
  for (const sidecar of entry.previousSidecars) {
    const prior = [...original.subtitles, ...original.subtitleHistory].find(
      (row) => row.id === sidecar.subtitleId,
    );
    if (prior?.path == null)
      throw new Error("Movie rollback original sidecar path disappeared");
    await tx.subtitleAsset.update({
      where: { id: sidecar.subtitleId },
      data: { path: prior.path },
    });
  }
  await advanceSubtitleBindings(tx, {
    assetId: intent.predecessor.id,
    checksum: intent.predecessor.checksum,
    epoch: intent.authority.recoveryEpoch,
    fromVersion: intent.predecessor.version,
    toVersion: intent.predecessor.version + 1,
    fromState: "superseded",
    sidecarIds: entry.previousSidecars.map((row) => row.subtitleId),
    state: "installed",
  });
  await tx.assetCoverage.updateMany({
    where: {
      assetId: intent.predecessor.id,
      mediaId: intent.scope.mediaId,
      edition: intent.scope.edition,
      current: false,
    },
    data: { current: true },
  });
  const retiredPointer = await retireMovieRollbackBindingV1(tx, {
    intent,
    captured: input.binding,
    budget: invocation.budget,
    freshness,
  });
  await tx.mediaIntent.update({
    where: {
      mediaId_edition: {
        mediaId: intent.scope.mediaId,
        edition: intent.scope.edition,
      },
    },
    data: { availability: "importing" },
  });
  await tx.mediaItem.update({
    where: { id: intent.scope.mediaId },
    data: {
      version: { increment: 1 },
      ...(intent.scope.edition === "default"
        ? { availability: "importing" as const }
        : {}),
    },
  });
  const predecessor = await snapshotMoviePublicationAssetV2(
    tx,
    intent.scope,
    intent.predecessor.id,
    invocation.budget,
  );
  const successor = await snapshotMoviePublicationAssetV2(
    tx,
    intent.scope,
    intent.successor.id,
    invocation.budget,
  );
  const receipt = MovieRollbackPhysicalV1Schema.parse({
    schemaVersion: 1,
    transactionId: await movieRollbackTransactionId(tx),
    operationId: intent.operationId,
    intentId: intent.id,
    intentHash: identityHash(intent),
    scope: intent.scope,
    predecessor,
    successor,
    bindingRaw: canonicalJson(z.json().parse(predecessor)),
    bindingHash: identityHash(predecessor),
    physicalEvidenceRaw: canonicalJson(z.json().parse(input.evidence)),
    physicalEvidenceHash: identityHash(input.evidence),
    retiredPointer,
    ...input.evidence,
    ...(input.manualPlayback === undefined
      ? {}
      : { playback: input.manualPlayback.reference }),
    observedAt: new Date(context.execution.observed.wall).toISOString(),
    sdkExpiresAt: new Date(context.execution.expiresAtMs).toISOString(),
    expiresAt: new Date(freshness.expiresAtMs).toISOString(),
    committedAt: new Date().toISOString(),
  });
  assertMovieRollbackPhysicalV1(intent, receipt);
  const envelope = {
    receipt: z.json().parse(receipt),
    receiptHash: identityHash(receipt),
    raw: canonicalJson(z.json().parse(receipt)),
  };
  freshness.assertActive();
  const changed =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackPhysicalV1',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${intent.operationId} AND result#>>'{movieRollbackIntentV1,intentHash}'=${identityHash(intent)} AND NOT(COALESCE(result,'{}'::jsonb)?'movieRollbackPhysicalV1')`;
  if (changed !== 1)
    throw new Error(
      "Movie rollback physical completion lost its exact admitted operation",
    );
  await context.checkpoint("movie-rollback-before-commit");
  freshness.assertActive();
  return receipt;
}
