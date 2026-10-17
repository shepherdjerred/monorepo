import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  PublicationIntentSchema,
  PublicationIntentRefSchema,
  type PublicationIntent,
  type PublicationIntentRef,
} from "#shared/publication-proof/intent.ts";
import {
  PublicationOutcomeSchema,
  type PublicationOutcome,
} from "#shared/publication-proof/outcome.ts";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import {
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { snapshotPublicationAsset } from "./snapshots.ts";
import type { PublicationAuthorityReadBudget } from "./read-budget.ts";
import { assertPublicationSubtitleEvidence } from "./subtitle-evidence.ts";

export async function loadPublicationIntent(
  tx: Prisma.TransactionClient,
  attemptId: string,
  budget?: PublicationAuthorityReadBudget,
): Promise<PublicationIntentRef | null> {
  const row = await tx.mediaPublicationTransition.findUnique({
    where: { attemptId },
  });
  if (row === null) return null;
  budget?.consume(1);
  if (
    snapshotHash(nativeJson(row.intent)) !== row.intentHash ||
    (row.outcome !== null &&
      snapshotHash(nativeJson(row.outcome)) !== row.outcomeHash)
  )
    throw new Error("Publication stored raw JSON hash changed");
  const intent = PublicationIntentSchema.parse(row.intent);
  for (const entry of intent.entries) assertPublicationSubtitleEvidence(entry);
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: row.attemptId },
  });
  if (
    snapshotHash(nativeJson(attempt.filePlan)) !== row.filePlanHash ||
    attempt.recoveryEpoch !== row.birthEpoch ||
    attempt.operationId !== intent.operationId ||
    attempt.edition !== "default"
  )
    throw new Error(
      "Publication original raw FilePlan or birth authority changed",
    );
  if (
    row.id !== intent.transitionId ||
    row.attemptId !== intent.attemptId ||
    row.birthEpoch !== intent.birthEpoch ||
    row.filePlanHash !== intent.filePlanHash ||
    row.intentHash !== snapshotHash(nativeJson(intent))
  )
    throw new Error("Publication intent row binding changed");
  assertStoredOutcome(row);
  return PublicationIntentRefSchema.parse({
    transitionId: row.id,
    intentHash: row.intentHash,
    intent,
  });
}

/** Caller holds the complete acquisition locks and actual path proofs before this separate commit. */
export async function createPublicationIntent(
  tx: Prisma.TransactionClient,
  input: PublicationIntent,
): Promise<PublicationIntentRef> {
  const intent = PublicationIntentSchema.parse(input);
  for (const entry of intent.entries) assertPublicationSubtitleEvidence(entry);
  const previous = await loadPublicationIntent(tx, intent.attemptId);
  if (previous !== null) {
    if (previous.intentHash !== snapshotHash(nativeJson(intent)))
      throw new Error("Publication intent cannot be replaced");
    return previous;
  }
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: intent.attemptId },
  });
  if (
    attempt.state === "imported" ||
    attempt.state === "completed" ||
    attempt.edition !== "default" ||
    attempt.operationId !== intent.operationId ||
    attempt.recoveryEpoch !== intent.birthEpoch ||
    snapshotHash(nativeJson(attempt.filePlan)) !== intent.filePlanHash ||
    snapshotHash(nativeAttempt(attempt)) !== intent.attemptSnapshotHash ||
    snapshotHash([...attempt.mediaIds].sort()) !==
      snapshotHash([...intent.mediaIds].sort())
  )
    throw new Error(
      "Publication intent does not match the uncommitted attempt",
    );
  const plan = z
    .array(FilePlanEntrySchema)
    .min(1)
    .max(100)
    .parse(attempt.filePlan);
  if (plan.length !== intent.entries.length)
    throw new Error("Publication intent omitted plan entries");
  for (const item of intent.entries) await assertEntry(tx, item, plan);
  const intentHash = snapshotHash(nativeJson(intent));
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

/** Actual physical result and DB publication are committed by the same caller transaction. */
export async function commitPublicationOutcome(
  tx: Prisma.TransactionClient,
  input: { intent: PublicationIntentRef; outcome: PublicationOutcome },
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "MediaPublicationTransition" WHERE id=${input.intent.transitionId} FOR UPDATE`;
  const stored = await loadPublicationIntent(tx, input.intent.intent.attemptId);
  if (
    stored === null ||
    snapshotHash(nativeJson(stored)) !== snapshotHash(nativeJson(input.intent))
  )
    throw new Error("Publication outcome intent changed");
  const outcome = PublicationOutcomeSchema.parse(input.outcome);
  if (
    outcome.transitionId !== stored.transitionId ||
    outcome.intentHash !== stored.intentHash ||
    outcome.filePlanHash !== stored.intent.filePlanHash ||
    outcome.birthEpoch !== stored.intent.birthEpoch ||
    outcome.entries.length !== stored.intent.entries.length ||
    new Set(outcome.entries.map((row) => row.entryOperationId)).size !==
      outcome.entries.length
  )
    throw new Error(
      "Publication outcome omitted or changed whole-plan authority",
    );
  const row = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: stored.transitionId },
  });
  const hash = snapshotHash(nativeJson(outcome));
  if (row.outcome !== null) {
    if (row.outcomeHash !== hash)
      throw new Error("Publication outcome is immutable");
    return;
  }
  await assertOutcomeEntries(tx, stored, outcome);
  if (outcome.effects.some((effect, index) => effect.ordinal !== index))
    throw new Error("Publication outcome effect prefix is not contiguous");
  await tx.mediaPublicationTransition.update({
    where: { id: row.id },
    data: {
      outcome: z.record(z.string(), z.json()).parse(outcome),
      outcomeHash: hash,
    },
  });
}

function assertStoredOutcome(
  row: Prisma.MediaPublicationTransitionGetPayload<Record<string, never>>,
) {
  if ((row.outcome === null) !== (row.outcomeHash === null))
    throw new Error("Publication outcome hash pair changed");
  if (row.outcome !== null) {
    const outcome = PublicationOutcomeSchema.parse(row.outcome);
    if (
      snapshotHash(nativeJson(outcome)) !== row.outcomeHash ||
      outcome.transitionId !== row.id ||
      outcome.intentHash !== row.intentHash ||
      outcome.filePlanHash !== row.filePlanHash ||
      outcome.birthEpoch !== row.birthEpoch
    )
      throw new Error("Publication outcome parent changed");
  }
}

async function assertEntry(
  tx: Prisma.TransactionClient,
  item: PublicationIntent["entries"][number],
  plan: z.infer<typeof FilePlanEntrySchema>[],
) {
  const entry = plan.find((row) => row.operationId === item.entry.operationId);
  if (
    entry === undefined ||
    snapshotHash(nativeJson(entry)) !== item.entryHash ||
    snapshotHash(nativeJson(item.entry)) !== item.entryHash
  )
    throw new Error("Publication entry does not match original plan");
  if (entry.previousAssetId === null) {
    if (item.predecessor !== null || item.originalGrant !== null)
      throw new Error("Initial publication has no predecessor grant");
  } else if (
    item.predecessor?.id !== entry.previousAssetId ||
    item.predecessor.version !== entry.previousVersion ||
    item.predecessor.checksum !== entry.previousChecksum ||
    snapshotHash(
      nativeJson(await snapshotPublicationAsset(tx, entry.previousAssetId)),
    ) !== snapshotHash(nativeJson(item.predecessor))
  ) {
    throw new Error("Publication predecessor snapshot changed");
  }
  if (await tx.libraryAsset.count({ where: { id: entry.assetId } }))
    throw new Error("Publication successor already exists without this intent");
  if (
    item.participants.some(
      (participant) =>
        participant.libraryKind !== entry.libraryKind ||
        ![entry.assetId, entry.previousAssetId].includes(participant.assetId),
    )
  )
    throw new Error("Publication participant is outside its exact entry");
}

async function assertOutcomeEntries(
  tx: Prisma.TransactionClient,
  stored: PublicationIntentRef,
  outcome: PublicationOutcome,
) {
  for (const result of outcome.entries) {
    const item = stored.intent.entries.find(
      (entry) => entry.entry.operationId === result.entryOperationId,
    );
    if (item === undefined)
      throw new Error("Publication outcome entry is unknown");
    for (const asset of [result.predecessor, result.successor]) {
      if (
        asset !== null &&
        snapshotHash(
          nativeJson(await snapshotPublicationAsset(tx, asset.id)),
        ) !== snapshotHash(nativeJson(asset))
      )
        throw new Error(
          "Publication outcome does not match committed asset rows",
        );
    }
    if (
      (result.predecessor?.id ?? null) !== item.entry.previousAssetId ||
      (outcome.kind === "published" &&
        (result.successor?.id !== item.entry.assetId ||
          result.successor.state !== "published")) ||
      (outcome.kind === "compensated" &&
        result.predecessor !== null &&
        result.predecessor.state !== "published")
    )
      throw new Error("Publication outcome lifecycle is inconsistent");
  }
}
