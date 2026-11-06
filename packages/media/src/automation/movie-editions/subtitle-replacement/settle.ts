import { z } from "zod";
import type { Prisma, SubtitleReplacement } from "#generated/prisma/client.ts";
import type { FileContext } from "#automation/files/types.ts";
import {
  MovieReplacementSnapshotV2Schema,
  MovieReplacementReceiptV2Schema,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import {
  replacementPaths,
  readReplacementJournal,
  type ReplacementProof,
} from "#automation/subtitle-replacement/files.ts";
import { artifactIdentity } from "#automation/subtitle-replacement/execution.ts";
import { publicationSubtitleSnapshot } from "#infrastructure/publication-proof/snapshots.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { readMovieReplacementReceiptV2 } from "#infrastructure/movie-editions/subtitle-replacement/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { movieReplacementFreshness } from "./authority.ts";
import { queueReadyMovieReplacementCaptionsV2 } from "#automation/movie-editions/notifications/replacement-captions.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** New schema2 settlement retains the old native swap and writes its own literal scoped proof. */
export async function settleMovieReplacementV2(
  tx: Prisma.TransactionClient,
  context: FileContext,
  row: SubtitleReplacement,
  input: {
    outcome: "installed" | "compensated" | "abandoned";
    proof: ReplacementProof;
  },
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error("Movie caption settlement lost its original invocation");
  const snapshot = MovieReplacementSnapshotV2Schema.parse(row.snapshot);
  const paths = replacementPaths(context, row);
  const original = movieReplacementFreshness(context);
  const physical = await publicationAuthorityDeadline(
    tx,
    {
      ...context,
      execution: invocation.execution,
      contentProof: input.proof.content,
    },
    { libraryKind: "movies", recoveryEpoch: row.recoveryEpoch },
  );
  const review =
    input.outcome === "installed"
      ? await tx.subtitleReplacementReview.findUniqueOrThrow({
          where: { replacementId: row.id },
        })
      : null;
  const expiresAtMs = Math.min(
    original.expiresAtMs,
    physical.expiresAtMs,
    review?.expiresAt.getTime() ?? Infinity,
  );
  const freshness = plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs,
    guards: [original, physical],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  const old =
    input.outcome === "installed"
      ? await tx.subtitleAsset.update({
          where: { id: row.oldSubtitleId, version: snapshot.old.version },
          data: {
            state: "superseded",
            path: paths.storedPath(paths.oldArchive),
            version: { increment: 1 },
          },
        })
      : await tx.subtitleAsset.findUniqueOrThrow({
          where: { id: row.oldSubtitleId },
        });
  const candidate = await tx.subtitleAsset.update({
    where: { id: row.candidateSubtitleId, version: snapshot.candidate.version },
    data:
      input.outcome === "installed"
        ? {
            state: "installed",
            path: snapshot.destination,
            version: { increment: 1 },
            matchingEvidence: {
              ...z
                .record(z.string(), z.json())
                .parse(snapshot.candidate.matchingEvidence),
              movieReplacementV2: { schemaVersion: 2, replacementId: row.id },
            },
          }
        : { state: "failed", version: { increment: 1 } },
  });
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(row.coordinatorOperationId) },
  });
  invocation.budget.consume(1);
  const artifacts = [];
  for (const name of [
    "source",
    "staged",
    "partial",
    "oldArchive",
    "rejected",
    "rollbackStaged",
  ] as const) {
    const filename = input.proof.paths[name];
    artifacts.push({
      name,
      path: filename,
      identity:
        (await input.proof.content.digest(filename)) === null
          ? null
          : await artifactIdentity(input.proof, filename),
    });
  }
  const journal = await readReplacementJournal(paths, row.importOperationId);
  const settledAt = new Date();
  const receipt = MovieReplacementReceiptV2Schema.parse({
    schemaVersion: 2,
    snapshotHash: row.snapshotHash,
    recoveryEpoch: row.recoveryEpoch,
    scope: snapshot.scope,
    oldSubtitleId: row.oldSubtitleId,
    candidateSubtitleId: row.candidateSubtitleId,
    videoVersion: snapshot.asset.version,
    oldPath: snapshot.destination,
    archivePath: paths.storedPath(paths.oldArchive),
    rejectedPath: paths.storedPath(paths.rejected),
    importOperationId: row.importOperationId,
    rollbackOperationId: row.rollbackOperationId,
    settledAt: settledAt.toISOString(),
    artifacts,
    source: snapshot.source,
    command: {
      operationId: command.id,
      kind: command.kind,
      actorId: command.userId,
      payloadHash: identityHash(nativeJson(command.payload)),
    },
    before: { old: snapshot.old, candidate: snapshot.candidate },
    after: {
      old: publicationSubtitleSnapshot(old),
      candidate: publicationSubtitleSnapshot(candidate),
    },
    journal:
      journal === null
        ? null
        : {
            ...journal,
            source: paths.storedPath(journal.source),
            target: paths.storedPath(journal.target),
          },
    observedAt: new Date(invocation.execution.observed.wall).toISOString(),
    sdkExpiresAt: new Date(invocation.execution.expiresAtMs).toISOString(),
    expiresAt: new Date(freshness.expiresAtMs).toISOString(),
  });
  const recorded = await tx.subtitleReplacementReceipt.create({
    data: {
      replacementId: row.id,
      outcome: input.outcome,
      evidence: z.record(z.string(), z.json()).parse(nativeJson(receipt)),
    },
  });
  await tx.subtitleReplacement.update({
    where: { id: row.id },
    data: {
      state:
        input.outcome === "installed"
          ? "applied"
          : input.outcome === "compensated"
            ? "rolled_back"
            : "abandoned",
      reservationActive: false,
      reason: null,
      appliedAt: settledAt,
      archiveExpiresAt: new Date(settledAt.getTime() + 7 * 86_400_000),
      version: { increment: 1 },
    },
  });
  await assertCompensationReceipt(tx, row.id, input.outcome, invocation.budget);
  await tx.applicationEvent.upsert({
    where: { dedupeKey: `movie-subtitle-replaced-v2:${row.id}` },
    update: {},
    create: {
      dedupeKey: `movie-subtitle-replaced-v2:${row.id}`,
      actorId: command.userId,
      mediaId: snapshot.scope.mediaId,
      kind: "movie_subtitle_replacement_settled_v2",
      payload: {
        schemaVersion: 2,
        scope: snapshot.scope,
        replacementId: row.id,
        receiptId: recorded.id,
        receiptHash: identityHash(nativeJson(receipt)),
        receiptRaw: canonicalJson(nativeJson(receipt)),
        outcome: input.outcome,
      },
    },
  });
  if (input.outcome === "installed") {
    const access = requireMovieChoiceAccess(
      (await fileMovieAccess(context, [snapshot.scope.mediaId])) ?? {},
    );
    const notices = await queueReadyMovieReplacementCaptionsV2(
      tx,
      {
        scope: snapshot.scope,
        assetId: row.assetId,
        subtitleId: row.candidateSubtitleId,
        replacementId: row.id,
        epoch: row.recoveryEpoch,
        access,
      },
      invocation.budget,
    );
    for (const guard of notices.guards) guard.assertActive();
  }
  freshness.assertActive();
}

async function assertCompensationReceipt(
  tx: Prisma.TransactionClient,
  replacementId: string,
  outcome: "installed" | "compensated" | "abandoned",
  budget: PublicationAuthorityReadBudget,
) {
  if (outcome === "installed") return;
  if ((await readMovieReplacementReceiptV2(tx, replacementId, budget)) === null)
    throw new Error(
      "Movie caption replacement did not commit its actual receipt",
    );
}
