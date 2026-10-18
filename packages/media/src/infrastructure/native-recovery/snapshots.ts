import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { historicalDefaultRow } from "./legacy-snapshot.ts";
import {
  historicalRequest,
  historicalRequestSelect,
} from "./historical-request.ts";

export function nativeJson(value: unknown) {
  const encoded = JSON.stringify(value);
  return z.json().parse(JSON.parse(encoded));
}
export function nativeAttempt(row: {
  id: string;
  releaseId: string;
  sponsorRequestId: string;
  mediaIds: string[];
  generations: Prisma.JsonValue;
  state: string;
  torrentId: string | null;
  operationId: string;
  coordinatorOperationId: string | null;
  failure: Prisma.JsonValue;
  filePlan: Prisma.JsonValue;
  recoveryEpoch: number;
}) {
  return nativeJson({
    id: row.id,
    releaseId: row.releaseId,
    sponsorRequestId: row.sponsorRequestId,
    mediaIds: row.mediaIds,
    generations: row.generations,
    state: row.state,
    torrentId: row.torrentId,
    operationId: row.operationId,
    coordinatorOperationId: row.coordinatorOperationId,
    failure: row.failure,
    filePlan: row.filePlan,
    recoveryEpoch: row.recoveryEpoch,
  });
}
const Record = z.object({ id: z.uuid() }).catchall(z.json());
const Request = Record.extend({
  mediaId: z.uuid(),
  userId: z.uuid(),
  active: z.boolean(),
  version: z.int(),
});
const Coverage = z
  .object({
    rootRequestId: z.uuid(),
    requestId: z.uuid(),
    mediaId: z.uuid(),
    active: z.boolean(),
    sourceVersion: z.int(),
  })
  .catchall(z.json());
export const NativeHouseholdSchema = z.strictObject({
  requests: z.array(Request).max(1000),
  coverage: z.array(Coverage).max(1000),
  personalHolds: z
    .array(
      Record.extend({
        mediaId: z.uuid(),
        userId: z.uuid(),
        isPin: z.boolean(),
      }),
    )
    .max(1000),
  recoveryHolds: z
    .array(
      z
        .object({ mediaId: z.uuid(), recoveryEpoch: z.int(), version: z.int() })
        .catchall(z.json()),
    )
    .max(100),
});
export const NativeLifecycleSchema = z.strictObject({
  attempts: z
    .array(
      Record.extend({
        recoveryEpoch: z.int(),
        state: z.string(),
        mediaIds: z.array(z.uuid()),
      }),
    )
    .max(100),
  reservations: z
    .array(
      z
        .object({ mediaId: z.uuid(), attemptId: z.uuid(), generation: z.int() })
        .catchall(z.json()),
    )
    .max(100),
  retention: z
    .array(
      Record.extend({
        mediaId: z.uuid(),
        generation: z.int(),
        state: z.string(),
      }),
    )
    .max(100),
  cleanup: z.array(Record).max(100),
});

export async function nativeHousehold(
  tx: Prisma.TransactionClient,
  ids: string[],
  ancestors: string[],
) {
  const coverage = await tx.requestCoverage.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: [{ rootRequestId: "asc" }, { mediaId: "asc" }],
    take: 1001,
  });
  const requests = await tx.mediaRequest.findMany({
    select: historicalRequestSelect,
    where: {
      edition: "default",
      OR: [
        { mediaId: { in: [...ids, ...ancestors] } },
        { id: { in: coverage.map((row) => row.rootRequestId) } },
      ],
    },
    orderBy: { id: "asc" },
    take: 1001,
  });
  const personalHolds = await tx.retentionHold.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: { id: "asc" },
    take: 1001,
  });
  const recoveryHolds = await tx.recoveryHold.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: { mediaId: "asc" },
  });
  return NativeHouseholdSchema.parse(
    nativeJson({
      requests: requests.map((row) => historicalRequest(row)),
      coverage: coverage.map((row) => historicalDefaultRow(row)),
      personalHolds: personalHolds.map((row) => historicalDefaultRow(row)),
      recoveryHolds: recoveryHolds.map((row) => historicalDefaultRow(row)),
    }),
  );
}

export async function nativeLifecycle(
  tx: Prisma.TransactionClient,
  ids: string[],
  assetIds: string[],
  settled: {
    decisionIds?: readonly string[];
    attemptIds?: readonly string[];
  } = {},
) {
  const {
    decisionIds: settledDecisionIds = [],
    attemptIds: settledAttemptIds = [],
  } = settled;
  const attempts = await tx.acquisitionAttempt.findMany({
    where: { edition: "default", mediaIds: { hasSome: ids } },
    orderBy: { id: "asc" },
    take: 101,
  });
  const reservations = await tx.acquisitionReservation.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: { mediaId: "asc" },
  });
  const retention = await tx.retentionDecision.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: { id: "asc" },
    take: 101,
  });
  const cleanup = await tx.upgradeCleanup.findMany({
    where: {
      OR: [
        { assetId: { in: assetIds } },
        { successorAssetId: { in: assetIds } },
      ],
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (
    reservations.length > 0 ||
    attempts.some(
      (row) =>
        !settledAttemptIds.includes(row.id) &&
        !["completed", "cancelled", "obsolete", "rolled_back"].includes(
          row.state,
        ),
    ) ||
    retention.some(
      (row) =>
        row.manifest !== null &&
        !["cancelled", "restored", "purged"].includes(row.state) &&
        !settledDecisionIds.includes(row.id),
    )
  )
    throw new Error(
      "Native recovery lifecycle requires separate reconciliation",
    );
  return NativeLifecycleSchema.parse(
    nativeJson({
      attempts: attempts.map((attempt) => nativeAttempt(attempt)),
      reservations: reservations.map((row) => historicalDefaultRow(row)),
      retention: retention.map((row) => historicalDefaultRow(row)),
      cleanup,
    }),
  );
}
