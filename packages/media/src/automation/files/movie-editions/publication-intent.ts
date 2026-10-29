import path from "node:path";
import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { assertInitialParticipants } from "#automation/publication-proof/intent.ts";
import { observePublicationParticipants } from "#automation/publication-proof/participants.ts";
import { publicationSubtitleEvidence } from "#automation/publication-proof/subtitle-lineage.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MoviePublicationIntentV2Schema } from "#shared/movie-editions/publication-v2.ts";
import type { MovieFilePlan } from "#shared/movie-editions/management/contracts.ts";
import {
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { durablePublicationJournal } from "#filesystem/publication-proof/journal.ts";
import { safePath, exists } from "#filesystem/operations-io.ts";

const hash = (value: unknown) => snapshotHash(nativeJson(value));

/** Capture actual staging, predecessor and caption evidence while the shared producer holds DB and path locks. */
export async function captureMoviePublicationV2(
  tx: Prisma.TransactionClient,
  input: {
    context: PublicationContext;
    attempt: AcquisitionAttempt;
    plan: MovieFilePlan;
    transitionId: string;
    rawFilePlanHash: string;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { context, attempt, plan } = input;
  if (
    hash(attempt.filePlan) !== input.rawFilePlanHash ||
    hash(plan) !== input.rawFilePlanHash
  )
    throw new FileGuardError("publication_plan_changed");
  const entry = plan.entries[0];
  const predecessor =
    entry.previousAssetId === null
      ? null
      : await snapshotMoviePublicationAssetV2(
          tx,
          plan.scope,
          entry.previousAssetId,
          budget,
        );
  const originalGrant =
    predecessor === null
      ? null
      : await findMoviePublicationReferenceV2(
          tx,
          { scope: plan.scope, asset: predecessor },
          budget,
        );
  if (predecessor !== null && originalGrant === null)
    throw new FileGuardError("movie_publication_predecessor_unproven");
  const participants = await observePublicationParticipants(context, entry);
  assertInitialParticipants(entry, participants);
  const roots = context.roots.movies;
  for (const id of [
    `recover-${entry.assetId}`,
    ...entry.previousSidecars.map((item) => item.operationId),
  ])
    if (
      await exists(await safePath(roots.control, `journal/${id}.json`, false))
    )
      throw new FileGuardError("publication_effect_without_intent");
  const journal = await durablePublicationJournal(roots, {
    version: 1,
    operationId: entry.operationId,
    kind: "import",
    source: path.join(roots.downloads, entry.downloadPath),
    target: path.join(roots.library, entry.libraryPath),
    sha256: entry.checksum,
    previousSha256: entry.previousChecksum,
    phase: "staged",
  });
  const prepared =
    predecessor === null
      ? undefined
      : context.preparedSubtitleLineages?.get(predecessor.id);
  const lineage = originalGrant?.subtitleLineage;
  if (
    lineage === undefined
      ? prepared !== undefined
      : prepared === undefined || hash(prepared.lineage) !== hash(lineage)
  )
    throw new FileGuardError("publication_subtitle_lineage_changed");
  let subtitleEvidence;
  if (prepared !== undefined) {
    if (context.contentProof === undefined)
      throw new Error("Movie publication content proof missing");
    subtitleEvidence = await publicationSubtitleEvidence(
      context,
      context.contentProof,
      prepared,
    );
  }
  return MoviePublicationIntentV2Schema.parse({
    schemaVersion: 2,
    scope: plan.scope,
    transitionId: input.transitionId,
    attemptId: attempt.id,
    operationId: attempt.operationId,
    birthEpoch: attempt.recoveryEpoch,
    filePlanHash: input.rawFilePlanHash,
    attemptSnapshotHash: snapshotHash(nativeAttempt(attempt)),
    mediaIds: attempt.mediaIds,
    entries: [
      {
        entry,
        entryHash: hash(entry),
        predecessor,
        originalGrant,
        participants,
        journals: [journal],
        ...(subtitleEvidence === undefined ? {} : { subtitleEvidence }),
      },
    ],
  });
}
