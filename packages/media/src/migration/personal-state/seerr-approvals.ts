import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { MigrationRecordSchema } from "#shared/migration.ts";
import {
  PersonalMigrationClaimSchema,
  seerrRequestReferenceKey,
  type PersonalMigrationClaim,
} from "#shared/personal-migration/contract.ts";

const ReviewedCaptures = z.object({
  captures: z
    .array(
      z.object({
        id: z.uuid(),
        captureHash: z.string(),
        sourceKind: z.string(),
      }),
    )
    .max(20),
  fullSeerrReview: z.boolean().optional(),
});

const ApprovalReceipt = ReviewedCaptures.extend({
  claims: z.array(PersonalMigrationClaimSchema).max(1000),
  sourceRecords: z
    .array(
      z.object({
        captureId: z.uuid(),
        provenanceKey: z.string(),
        observationHash: z.string(),
      }),
    )
    .max(1000),
});

const captureFields = {
  completedAt: true,
  complete: true,
  stable: true,
  manifestHash: true,
  sourceKind: true,
  sourceInstanceId: true,
} as const;
type SourceRecord = Prisma.MigrationRecordGetPayload<{
  include: { capture: { select: typeof captureFields } };
}>;
type ReceiptCapture = z.infer<typeof ApprovalReceipt>["captures"][number];
type ReviewedCapture = Prisma.MigrationCaptureGetPayload<{
  select: typeof captureFields & { id: true };
}>;

function sourceKey(
  capture: Pick<ReviewedCapture, "sourceKind" | "sourceInstanceId">,
) {
  return JSON.stringify([capture.sourceKind, capture.sourceInstanceId]);
}

async function readReviewedCaptures(
  tx: Prisma.TransactionClient,
  references: readonly ReceiptCapture[],
) {
  const exactReferences = references.filter((reference) =>
    ["seerr", "overseerr", "jellyseerr"].includes(reference.sourceKind),
  );
  const byId = new Map(
    exactReferences.map((reference) => [reference.id, reference]),
  );
  if (byId.size === 0) return [];
  const captures = await tx.migrationCapture.findMany({
    where: { id: { in: [...byId.keys()] } },
    select: { id: true, ...captureFields },
  });
  if (
    captures.length !== byId.size ||
    captures.some((capture) => {
      const reference = byId.get(capture.id);
      return (
        reference?.captureHash !== capture.manifestHash ||
        reference.sourceKind !== capture.sourceKind ||
        !capture.complete ||
        !capture.stable
      );
    })
  )
    throw new Error("Full Seerr review lost its exact source capture");
  return captures;
}

async function latestFullReviews(tx: Prisma.TransactionClient) {
  const receipts = await tx.applicationEvent.findMany({
    where: {
      kind: "personal_state_imported",
      actorId: { not: null },
      payload: { path: ["fullSeerrReview"], equals: true },
    },
    select: { payload: true },
    take: 1001,
  });
  if (receipts.length > 1000)
    throw new Error("Full Seerr review exceeds bounded receipt history");
  const captures = await readReviewedCaptures(
    tx,
    receipts.flatMap(
      (receipt) => ReviewedCaptures.parse(receipt.payload).captures,
    ),
  );
  const latest = new Map<string, Date>();
  for (const capture of captures) {
    const key = sourceKey(capture);
    const current = latest.get(key);
    if (current === undefined || capture.completedAt > current)
      latest.set(key, capture.completedAt);
  }
  return latest;
}

function requireSourceRecord(
  claim: PersonalMigrationClaim,
  facts: {
    record: SourceRecord | undefined;
    capture: ReceiptCapture | undefined;
    observationHash: string | undefined;
  },
) {
  const { record, capture, observationHash } = facts;
  if (
    record === undefined ||
    capture === undefined ||
    observationHash !== record.observationHash ||
    capture.captureHash !== record.capture.manifestHash ||
    capture.sourceKind !== record.capture.sourceKind ||
    !record.capture.complete ||
    !record.capture.stable ||
    snapshotHash(z.json().parse(record.payload)) !== record.observationHash
  )
    throw new Error("Seerr approval lost its exact source record");

  const source = MigrationRecordSchema.parse(record.payload);
  if (
    source.kind !== "request" ||
    source.sourceId !== claim.sourceId ||
    source.requesterSourceId !== claim.requesterSourceId ||
    (source.sourceStatus ?? null) !== claim.sourceStatus ||
    (claim.plexAccountId !== undefined &&
      source.plexAccountId !== claim.plexAccountId)
  )
    throw new Error("Seerr approval changed from its source request");
  return record;
}

async function readApprovalReceipt(
  tx: Prisma.TransactionClient,
  receiptId: string,
  claims: readonly PersonalMigrationClaim[],
  fullSourceReview: boolean,
) {
  const receipt = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: receiptId },
    select: { actorId: true, kind: true, payload: true },
  });
  if (receipt.kind !== "personal_state_imported" || receipt.actorId === null)
    throw new Error("Seerr approval requires a personal import receipt");
  const approved = ApprovalReceipt.parse(receipt.payload);
  if (
    (approved.fullSeerrReview === true) !== fullSourceReview ||
    snapshotHash(z.json().parse(approved.claims)) !==
      snapshotHash(z.json().parse(claims))
  )
    throw new Error("Seerr approval changed from the reviewed receipt");
  return approved;
}

async function readApprovedRecords(
  tx: Prisma.TransactionClient,
  approved: z.infer<typeof ApprovalReceipt>,
) {
  const { claims } = approved;
  if (claims.length === 0) return [];
  const reviewedCaptures = new Map(
    approved.captures.map((capture) => [capture.id, capture]),
  );
  const reviewedRecords = new Map(
    approved.sourceRecords.map((record) => [
      seerrRequestReferenceKey(record),
      record,
    ]),
  );
  const records = await tx.migrationRecord.findMany({
    where: {
      kind: "request",
      OR: claims.map(({ captureId, provenanceKey }) => ({
        captureId,
        provenanceKey,
      })),
    },
    include: {
      capture: { select: captureFields },
    },
  });
  const stored = new Map(
    records.map((record) => [seerrRequestReferenceKey(record), record]),
  );
  return claims.map((claim) => {
    const key = seerrRequestReferenceKey(claim);
    const record = requireSourceRecord(claim, {
      record: stored.get(key),
      capture: reviewedCaptures.get(claim.captureId),
      observationHash: reviewedRecords.get(key)?.observationHash,
    });
    return { claim, capture: record.capture };
  });
}

async function retractOmittedApprovals(
  tx: Prisma.TransactionClient,
  receiptId: string,
  capture: ReviewedCapture,
  claims: readonly PersonalMigrationClaim[],
) {
  const { sourceKind, sourceInstanceId, completedAt } = capture;
  const olderCaptures = await tx.migrationCapture.findMany({
    where: { sourceKind, sourceInstanceId, completedAt: { lt: completedAt } },
    select: { id: true },
  });
  if (olderCaptures.length === 0) return;
  const included = claims.flatMap((claim) =>
    claim.captureId === capture.id ? [claim.provenanceKey] : [],
  );
  await tx.seerrRequestApproval.updateMany({
    where: {
      pending: true,
      captureId: { in: olderCaptures.map(({ id }) => id) },
      captureCompletedAt: { lt: completedAt },
      ...(included.length === 0 ? {} : { provenanceKey: { notIn: included } }),
    },
    data: {
      pending: false,
      attachmentEventId: null,
      captureId: capture.id,
      captureCompletedAt: completedAt,
      receiptId,
    },
  });
}

async function retractFullReview(
  tx: Prisma.TransactionClient,
  receiptId: string,
  approved: z.infer<typeof ApprovalReceipt>,
  fullReviews: ReadonlyMap<string, Date>,
) {
  for (const capture of await readReviewedCaptures(tx, approved.captures)) {
    const latest = fullReviews.get(sourceKey(capture));
    if (latest === undefined || latest <= capture.completedAt)
      await retractOmittedApprovals(tx, receiptId, capture, approved.claims);
  }
}

/** Called with the owner's approval receipt inside the personal import transaction. */
export async function recordSeerrApprovals(
  tx: Prisma.TransactionClient,
  receiptId: string,
  claims: readonly PersonalMigrationClaim[],
  fullSourceReview: boolean,
) {
  if (!fullSourceReview && claims.length === 0) return;
  const approved = await readApprovalReceipt(
    tx,
    receiptId,
    claims,
    fullSourceReview,
  );
  const records = await readApprovedRecords(tx, approved);
  const fullReviews = await latestFullReviews(tx);
  if (fullSourceReview)
    await retractFullReview(tx, receiptId, approved, fullReviews);

  const previous = await tx.seerrRequestApproval.findMany({
    where: {
      provenanceKey: { in: claims.map((claim) => claim.provenanceKey) },
    },
  });
  const latest = new Map(
    previous.map((approval) => [approval.provenanceKey, approval]),
  );

  for (const { claim, capture } of records) {
    const { completedAt } = capture;
    const latestFull = fullReviews.get(sourceKey(capture));
    if (latestFull !== undefined && latestFull > completedAt) continue;
    const plexAccountId = claim.plexAccountId ?? null;
    const prior = latest.get(claim.provenanceKey);
    if (prior !== undefined && prior.captureCompletedAt > completedAt) continue;
    const pending =
      claim.disposition === "deferred" &&
      plexAccountId !== null &&
      claim.edition !== null &&
      claim.mediaIds.length > 0;
    if (
      pending &&
      prior?.captureId === claim.captureId &&
      prior.plexAccountId === plexAccountId &&
      prior.attachmentEventId !== null
    )
      // A captured request already attached through this approval never rearms.
      continue;
    const approval = {
      captureId: claim.captureId,
      captureCompletedAt: completedAt,
      receiptId,
      plexAccountId,
      pending,
      attachmentEventId: null,
    };
    await tx.seerrRequestApproval.upsert({
      where: { provenanceKey: claim.provenanceKey },
      create: { provenanceKey: claim.provenanceKey, ...approval },
      update: approval,
    });
  }
}
