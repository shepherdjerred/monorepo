import { prisma } from "#src/database/index.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { persistRawObservation } from "./object-store.ts";
import { observationArchiveEnvelope } from "./envelope.ts";
import type { Prisma } from "#generated/prisma/client/index.js";

const RETRY_AFTER_MS = 60_000;
const PAGE_SIZE = 100;
const CONCURRENCY = 4;

/** Every persisted observation is its own durable archive job, regardless of disposition. */
export async function reconcileRawClientObservations(
  now = new Date(),
): Promise<number> {
  if (isFeatureHardDisabled("scout_client_ingestion")) return 0;
  const due = {
    rawArchivedAt: null,
    rawArchiveNextAttemptAt: { lte: now },
  };
  const rows = await prisma.scoutClientObservation.findMany({
    where: due,
    orderBy: [
      { rawArchiveNextAttemptAt: "asc" },
      { receivedAt: "asc" },
      { observationId: "asc" },
    ],
    take: PAGE_SIZE,
    select: { observationId: true },
  });
  const failures: unknown[] = [];
  let archived = 0;
  for (let offset = 0; offset < rows.length; offset += CONCURRENCY) {
    const results = await Promise.allSettled(
      rows
        .slice(offset, offset + CONCURRENCY)
        .map((row) => archiveRow(row.observationId, due)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") archived += result.value;
      else failures.push(result.reason);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Raw client observation archival failed; durable jobs remain pending",
    );
  return archived;
}

async function archiveRow(
  observationId: string,
  due: Prisma.ScoutClientObservationWhereInput,
): Promise<number> {
  const claimId = crypto.randomUUID();
  const claimed = await prisma.scoutClientObservation.updateMany({
    where: { ...due, observationId },
    data: {
      rawArchiveAttemptAt: new Date(),
      rawArchiveClaimId: claimId,
      rawArchiveNextAttemptAt: new Date(Date.now() + RETRY_AFTER_MS),
    },
  });
  if (claimed.count === 0) return 0;
  try {
    // Fetch only claimed payloads: a page of IDs must not buffer 100 large timelines.
    const row = await prisma.scoutClientObservation.findUniqueOrThrow({
      where: { observationId },
    });
    const rawEnvelope = observationArchiveEnvelope(row);
    if (row.rawEnvelope === null) {
      const frozen = await prisma.scoutClientObservation.updateMany({
        where: {
          observationId,
          rawArchiveClaimId: claimId,
          rawArchivedAt: null,
        },
        data: { rawEnvelope },
      });
      if (frozen.count === 0) return 0;
    }
    const object = await persistRawObservation({ ...row, rawEnvelope });
    const checkpoint = await prisma.scoutClientObservation.updateMany({
      where: {
        observationId,
        rawArchiveClaimId: claimId,
        rawArchivedAt: null,
      },
      data: {
        rawArchiveKey: object.key,
        rawArchiveDigest: object.digest,
        rawArchiveBytes: object.bytes,
        rawArchivedAt: new Date(),
        rawArchiveError: null,
        rawArchiveClaimId: null,
      },
    });
    return checkpoint.count;
  } catch (error) {
    await prisma.scoutClientObservation.updateMany({
      where: {
        observationId,
        rawArchiveClaimId: claimId,
        rawArchivedAt: null,
      },
      data: {
        rawArchiveError: "Object archival failed; retry remains pending",
        rawArchiveClaimId: null,
      },
    });
    throw error;
  }
}
