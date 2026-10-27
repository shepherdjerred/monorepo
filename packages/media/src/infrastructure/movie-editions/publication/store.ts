import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import {
  MoviePublicationIntentV2Schema,
  MoviePublicationOutcomeV2Schema,
  type MoviePublicationIntentV2,
  type MoviePublicationIntentRefV2,
  type MoviePublicationOutcomeV2,
  type MoviePublicationAssetV2,
  MoviePublicationReferenceV2Schema,
} from "#shared/movie-editions/publication-v2.ts";
import { MovieFilePlanV2Schema } from "#shared/movie-editions/file-plan-v2.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  nativeJson,
  nativeAttempt,
} from "#infrastructure/native-recovery/snapshots.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotMoviePublicationAssetV2 } from "./snapshot.ts";
import { compensationSubtitleLineage } from "#infrastructure/native-compensation/subtitle-lineage.ts";
import { assertPublicationSnapshotSuccessor } from "#infrastructure/publication-proof/authority.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { assertMoviePublicationTimesV2 } from "./timestamps.ts";
import { loadMoviePublicationV2, assertOutcomeBinding } from "./records.ts";

const hash = (value: unknown) => snapshotHash(nativeJson(value));

/** Resolve an actual completed scoped predecessor; serialized hashes alone never supply a physical grant. */
export async function findMoviePublicationReferenceV2(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; asset: MoviePublicationAssetV2 },
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.mediaPublicationTransition.findMany({
    where: {
      intent: { path: ["scope"], equals: input.scope },
      outcome: { not: Prisma.DbNull },
      OR: [
        {
          outcome: {
            path: ["entries"],
            array_contains: [
              {
                successor: { id: input.asset.id, version: input.asset.version },
              },
            ],
          },
        },
        {
          outcome: {
            path: ["entries"],
            array_contains: [
              {
                predecessor: {
                  id: input.asset.id,
                  version: input.asset.version,
                },
              },
            ],
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length === 0) return null;
  if (rows.length !== 1)
    throw new Error("Movie publication predecessor authority is ambiguous");
  const row = rows[0];
  if (row === undefined)
    throw new Error("Movie publication predecessor disappeared");
  const parent = await loadMoviePublicationV2(tx, row.attemptId, budget);
  if (parent?.outcome == null || parent.outcomeHash === null)
    throw new Error(
      "Movie publication predecessor has no immutable completed outcome",
    );
  const result = parent.outcome.entries[0];
  const baseline =
    result.successor?.id === input.asset.id
      ? result.successor
      : result.predecessor;
  if (
    baseline?.id !== input.asset.id ||
    baseline.version !== input.asset.version
  )
    throw new Error("Movie publication predecessor asset binding changed");
  assertPublicationSnapshotSuccessor(
    { ...baseline, subtitles: input.asset.subtitles },
    input.asset,
  );
  await assertMoviePublicationTimesV2(
    tx,
    {
      baseline,
      current: input.asset,
      successor: result.successor,
      publication: {
        transitionId: row.id,
        intentHash: row.intentHash,
        outcomeHash: parent.outcomeHash,
      },
    },
    budget,
  );
  const lineage = await compensationSubtitleLineage(
    tx,
    {
      baseline: {
        ...baseline,
        plexPublishedAt: input.asset.plexPublishedAt,
        rollbackExpiresAt: input.asset.rollbackExpiresAt,
      },
      current: input.asset,
      libraryKind: "movies",
    },
    budget,
  );
  return MoviePublicationReferenceV2Schema.parse({
    kind: "movie_publication_transition_v2",
    scope: input.scope,
    transitionId: row.id,
    intentHash: row.intentHash,
    outcomeHash: parent.outcomeHash,
    assetId: input.asset.id,
    assetVersion: input.asset.version,
    bindingHash: hash(baseline),
    physicalEvidenceHash: hash({
      effects: parent.outcome.effects,
      participants: result.participants,
      journals: result.journals,
    }),
    ...(lineage.lineage === undefined
      ? {}
      : { subtitleLineage: lineage.lineage }),
  });
}

/** Hash literal stored JSON before parsing; one caller-owned budget spans parents and repeated reads. */
export async function createMoviePublicationV2(
  tx: Prisma.TransactionClient,
  input: MoviePublicationIntentV2,
  budget: PublicationAuthorityReadBudget,
) {
  const intent = MoviePublicationIntentV2Schema.parse(input);
  const previous = await loadMoviePublicationV2(tx, intent.attemptId, budget);
  if (previous !== null) {
    if (previous.reference.intentHash !== hash(intent))
      throw new Error("Movie publication intent cannot be replaced");
    return previous.reference;
  }
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: intent.attemptId },
  });
  budget.consume(1);
  const plan = MovieFilePlanV2Schema.parse(attempt.filePlan);
  if (
    ["imported", "completed"].includes(attempt.state) ||
    hash(attempt.filePlan) !== intent.filePlanHash ||
    hash(plan) !== intent.filePlanHash ||
    attempt.recoveryEpoch !== intent.birthEpoch ||
    attempt.operationId !== intent.operationId ||
    hash(nativeAttempt(attempt)) !== intent.attemptSnapshotHash ||
    hash(plan.scope) !== hash(intent.scope) ||
    hash(plan.entries[0]) !== intent.entries[0].entryHash ||
    hash(intent.entries[0].entry) !== intent.entries[0].entryHash
  )
    throw new Error(
      "Movie publication intent differs from its original attempt and file plan",
    );
  await assertInitialEntry(tx, intent, budget);
  const intentHash = hash(intent);
  await tx.mediaPublicationTransition.create({
    data: {
      id: intent.transitionId,
      attemptId: intent.attemptId,
      birthEpoch: intent.birthEpoch,
      filePlanHash: intent.filePlanHash,
      intent: z.record(z.string(), z.json()).parse(intent),
      intentHash,
    },
  });
  return { transitionId: intent.transitionId, intentHash, intent };
}

async function assertInitialEntry(
  tx: Prisma.TransactionClient,
  intent: MoviePublicationIntentV2,
  budget: PublicationAuthorityReadBudget,
) {
  const item = intent.entries[0];
  const entry = item.entry;
  if (entry.previousAssetId === null) {
    if (item.predecessor !== null || item.originalGrant !== null)
      throw new Error(
        "Initial movie publication cannot borrow predecessor authority",
      );
  } else {
    if (
      item.predecessor?.id !== entry.previousAssetId ||
      item.predecessor.version !== entry.previousVersion ||
      item.predecessor.checksum !== entry.previousChecksum ||
      item.originalGrant === null ||
      hash(
        await snapshotMoviePublicationAssetV2(
          tx,
          intent.scope,
          entry.previousAssetId,
          budget,
        ),
      ) !== hash(item.predecessor)
    )
      throw new Error(
        "Movie publication predecessor scope, snapshot or grant changed",
      );
    const actualGrant = await findMoviePublicationReferenceV2(
      tx,
      { scope: intent.scope, asset: item.predecessor },
      budget,
    );
    if (hash(actualGrant) !== hash(item.originalGrant))
      throw new Error(
        "Movie publication predecessor grant is not its actual completed authority",
      );
  }
  const existing = await tx.libraryAsset.findUnique({
    where: { id: entry.assetId },
  });
  budget.consume(existing === null ? 0 : 1);
  if (existing !== null)
    throw new Error("Movie publication successor exists before its intent");
  if (
    item.participants.some(
      (participant) =>
        participant.libraryKind !== "movies" ||
        ![entry.assetId, entry.previousAssetId].includes(participant.assetId),
    )
  )
    throw new Error(
      "Movie publication participant lies outside the exact entry",
    );
}

export async function commitMoviePublicationOutcomeV2(
  tx: Prisma.TransactionClient,
  input: {
    reference: MoviePublicationIntentRefV2;
    outcome: MoviePublicationOutcomeV2;
  },
  budget: PublicationAuthorityReadBudget,
) {
  await tx.$queryRaw`SELECT id FROM "MediaPublicationTransition" WHERE id=${input.reference.transitionId} FOR UPDATE`;
  const stored = await loadMoviePublicationV2(
    tx,
    input.reference.intent.attemptId,
    budget,
  );
  if (stored === null || hash(stored.reference) !== hash(input.reference))
    throw new Error("Movie publication outcome intent changed");
  const outcome = MoviePublicationOutcomeV2Schema.parse(input.outcome);
  assertOutcomeBinding(stored.reference, outcome);
  const outcomeHash = hash(outcome);
  if (stored.outcome !== null) {
    if (stored.outcomeHash !== outcomeHash)
      throw new Error("Movie publication outcome is immutable");
    return;
  }
  for (const asset of [
    outcome.entries[0].predecessor,
    outcome.entries[0].successor,
  ]) {
    if (
      asset !== null &&
      hash(
        await snapshotMoviePublicationAssetV2(
          tx,
          outcome.scope,
          asset.id,
          budget,
        ),
      ) !== hash(asset)
    )
      throw new Error(
        "Movie publication outcome differs from committed asset rows",
      );
  }
  await tx.mediaPublicationTransition.update({
    where: { id: stored.reference.transitionId },
    data: {
      outcome: z.record(z.string(), z.json()).parse(outcome),
      outcomeHash,
    },
  });
}
