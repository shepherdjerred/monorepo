import type { Prisma } from "#generated/prisma/client.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import {
  PublicationTransitionReferenceSchema,
  type PublicationAuthorityReference,
} from "#shared/publication-proof/references.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import { assertPriorNativeBinding } from "#infrastructure/native-archive/prior-binding.ts";
import { compensationRecord } from "#infrastructure/native-compensation/records.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { loadPublicationIntent } from "./store.ts";
import type { NativeReceiptReadPort } from "#infrastructure/plex-binding/native/receipt-port.ts";
import { snapshotPublicationAsset } from "./snapshots.ts";
import {
  publicationArchiveSnapshot,
  publicationPhysicalSnapshot,
} from "./projection.ts";
import type { PublicationAuthorityReadBudget } from "./read-budget.ts";
import { compensationSubtitleLineage } from "#infrastructure/native-compensation/subtitle-lineage.ts";
import { assertRecordedCaptionLineage } from "./caption-authority.ts";

/** Only write-once ordinary verified-publication timestamps may follow the physical commit. */
export function assertPublicationSnapshotSuccessor(
  before: PublicationAssetSnapshot | MoviePublicationAssetV2,
  current: PublicationAssetSnapshot | MoviePublicationAssetV2,
): void {
  const expected = {
    ...before,
    plexPublishedAt: current.plexPublishedAt,
    rollbackExpiresAt: current.rollbackExpiresAt,
  };
  if (
    snapshotHash(nativeJson(publicationPhysicalSnapshot(expected))) !==
      snapshotHash(nativeJson(publicationPhysicalSnapshot(current))) ||
    (before.plexPublishedAt !== null &&
      before.plexPublishedAt !== current.plexPublishedAt) ||
    (before.rollbackExpiresAt !== null &&
      before.rollbackExpiresAt !== current.rollbackExpiresAt)
  )
    throw new Error("Publication transition current physical binding changed");
}

export async function resolvePublicationTransitionAuthority(
  tx: Prisma.TransactionClient,
  input: { transitionId: string; assetId: string },
  budget?: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
) {
  const result = await resolveTransition(tx, input, new Set<string>(), {
    budget,
    projection,
  });
  const current = await snapshotPublicationAsset(tx, input.assetId);
  assertPublicationSnapshotSuccessor(
    { ...result.snapshot, subtitles: current.subtitles },
    current,
  );
  let subtitleLineage;
  if (
    snapshotHash(nativeJson(result.snapshot.subtitles)) !==
    snapshotHash(nativeJson(current.subtitles))
  ) {
    const resolved = await compensationSubtitleLineage(
      tx,
      {
        baseline: {
          ...result.snapshot,
          plexPublishedAt: current.plexPublishedAt,
          rollbackExpiresAt: current.rollbackExpiresAt,
        },
        current,
        libraryKind: result.libraryKind,
      },
      budget,
    );
    subtitleLineage = resolved.lineage;
  }
  await assertPublicationTimes(tx, result, current);
  return {
    ...result.reference,
    ...(subtitleLineage === undefined ? {} : { subtitleLineage }),
    originalGrant: result.originalGrant,
  };
}
export type PublicationTransitionAuthority = Awaited<
  ReturnType<typeof resolvePublicationTransitionAuthority>
>;

/** Validate a frozen predecessor's original grant, never synthesize authority for a later version. */
export async function assertRecordedPublicationGrant(
  tx: Prisma.TransactionClient,
  input: {
    reference: PublicationAuthorityReference;
    snapshot: PublicationAssetSnapshot;
    libraryKind: "movies" | "tv";
  },
  budget?: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
): Promise<void> {
  await validateOriginal(
    tx,
    { ...input, seen: new Set<string>() },
    budget,
    projection,
  );
}

async function resolveTransition(
  tx: Prisma.TransactionClient,
  input: { transitionId: string; assetId: string },
  seen: Set<string>,
  options: {
    budget: PublicationAuthorityReadBudget | undefined;
    projection: NativeReceiptReadPort | undefined;
  },
): Promise<{
  reference: ReturnType<typeof PublicationTransitionReferenceSchema.parse>;
  originalGrant: Exclude<
    PublicationAuthorityReference,
    { kind: "publication_transition_binding" }
  >;
  snapshot: PublicationAssetSnapshot;
  outcome: ReturnType<typeof PublicationOutcomeSchema.parse>;
  libraryKind: "movies" | "tv";
}> {
  const { budget, projection } = options;
  if (seen.has(input.transitionId) || seen.size >= 100)
    throw new Error("Publication transition chain exceeds bound");
  seen.add(input.transitionId);
  budget?.consume(1);
  const row = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: input.transitionId },
  });
  const intent = await loadPublicationIntent(tx, row.attemptId, budget);
  if (intent === null || row.outcome === null || row.outcomeHash === null)
    throw new Error("Publication transition lacks committed physical outcome");
  const outcome = PublicationOutcomeSchema.parse(row.outcome);
  const matches = outcome.entries.filter(
    (entry) =>
      entry.predecessor?.id === input.assetId ||
      entry.successor?.id === input.assetId,
  );
  const result = matches[0];
  if (result === undefined || matches.length !== 1)
    throw new Error("Publication transition asset is not exactly adjacent");
  const before = intent.intent.entries.find(
    (entry) => entry.entry.operationId === result.entryOperationId,
  );
  if (before?.predecessor == null || before.originalGrant === null)
    throw new Error("Publication transition has no original native grant");
  const snapshot =
    result.predecessor?.id === input.assetId
      ? result.predecessor
      : result.successor;
  if (snapshot === null)
    throw new Error("Publication transition exact result missing");
  const originalGrant = await validateOriginal(
    tx,
    {
      reference: before.originalGrant,
      snapshot: before.predecessor,
      libraryKind: before.entry.libraryKind,
      seen,
    },
    budget,
    projection,
  );
  return {
    reference: PublicationTransitionReferenceSchema.parse({
      kind: "publication_transition_binding",
      transitionId: row.id,
      intentHash: row.intentHash,
      outcomeHash: row.outcomeHash,
      assetId: input.assetId,
      bindingHash: snapshotHash(nativeJson(result)),
      physicalEvidenceHash: snapshotHash(nativeJson(result.participants)),
    }),
    originalGrant,
    snapshot,
    outcome,
    libraryKind: before.entry.libraryKind,
  };
}

async function validateOriginal(
  tx: Prisma.TransactionClient,
  input: {
    reference: PublicationAuthorityReference;
    snapshot: PublicationAssetSnapshot;
    libraryKind: "movies" | "tv";
    seen: Set<string>;
  },
  budget?: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
): Promise<
  Exclude<
    PublicationAuthorityReference,
    { kind: "publication_transition_binding" }
  >
> {
  const { reference, snapshot, libraryKind, seen } = input;
  if (reference.assetId !== snapshot.id)
    throw new Error("Publication original grant names a different predecessor");
  if (reference.kind === "prior_native_binding") {
    await assertPriorNativeBinding(
      tx,
      publicationArchiveSnapshot(snapshot, libraryKind),
      reference,
      { budget, projection },
    );
    return reference;
  }
  if (reference.kind === "compensation_completion") {
    const record = await compensationRecord(
      tx,
      reference.continuationId,
      budget,
      projection,
    );
    const binding = record.completion?.predecessorBindings.find(
      (item) => item.after.id === snapshot.id,
    );
    if (
      binding === undefined ||
      record.completion === null ||
      reference.receiptId !== record.row.receiptId ||
      reference.planHash !== record.row.receipt.planHash ||
      reference.descriptorHash !== record.row.descriptorHash ||
      reference.completionHash !==
        snapshotHash(nativeJson(record.completion)) ||
      reference.bindingHash !== snapshotHash(nativeJson(binding)) ||
      reference.physicalEvidenceHash !==
        snapshotHash(nativeJson(binding.participants))
    )
      throw new Error("Publication original compensation reference changed");
    if (reference.subtitleLineage === undefined) {
      assertPublicationSnapshotSuccessor(binding.after, snapshot);
    } else {
      assertRecordedCaptionLineage(
        reference.subtitleLineage,
        binding.after.subtitles,
        snapshot.subtitles,
      );
      assertPublicationSnapshotSuccessor(
        { ...binding.after, subtitles: snapshot.subtitles },
        snapshot,
      );
    }
    return reference;
  }
  const previous = await resolveTransition(
    tx,
    { transitionId: reference.transitionId, assetId: reference.assetId },
    seen,
    { budget, projection },
  );
  const { subtitleLineage, ...originalReference } = reference;
  if (
    snapshotHash(nativeJson(previous.reference)) !==
    snapshotHash(nativeJson(originalReference))
  )
    throw new Error("Publication original adjacent transition changed");
  if (subtitleLineage !== undefined)
    assertRecordedCaptionLineage(
      subtitleLineage,
      previous.snapshot.subtitles,
      snapshot.subtitles,
    );
  assertPublicationSnapshotSuccessor(
    subtitleLineage === undefined
      ? previous.snapshot
      : { ...previous.snapshot, subtitles: snapshot.subtitles },
    snapshot,
  );
  return previous.originalGrant;
}

async function assertPublicationTimes(
  tx: Prisma.TransactionClient,
  result: Awaited<ReturnType<typeof resolveTransition>>,
  current: PublicationAssetSnapshot,
) {
  if (
    current.plexPublishedAt === result.snapshot.plexPublishedAt &&
    current.rollbackExpiresAt === result.snapshot.rollbackExpiresAt
  )
    return;
  if (current.state === "published") {
    if (current.plexPublishedAt === null)
      throw new Error("Publication transition current verification missing");
    return;
  }
  const successor = result.outcome.entries.find(
    (entry) => entry.predecessor?.id === current.id,
  )?.successor;
  if (successor === null || successor === undefined)
    throw new Error("Publication transition deadline successor missing");
  const published = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: successor.id },
  });
  if (
    published.plexPublishedAt === null ||
    current.rollbackExpiresAt === null ||
    Date.parse(current.rollbackExpiresAt) !==
      published.plexPublishedAt.getTime() + 7 * 24 * 60 * 60 * 1000
  )
    throw new Error(
      "Publication transition rollback deadline is not the verified successor deadline",
    );
  const cleanup = await tx.upgradeCleanup.findUnique({
    where: {
      assetId_successorAssetId: {
        assetId: current.id,
        successorAssetId: successor.id,
      },
    },
  });
  if (
    cleanup?.successorAssetId !== successor.id ||
    cleanup.expiresAt.toISOString() !== current.rollbackExpiresAt ||
    cleanup.recoveryEpoch !== current.ownershipEpoch
  )
    throw new Error(
      "Publication transition cleanup deadline authority changed",
    );
}
