import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";

const historical = () => new Date(Date.now() - 8 * 86_400_000);

/** Simulated elapsed grace at original producer writes, never a clock or authority override. */
export function elapsedWarningClient(
  db: Database,
  mediaIds: readonly string[],
) {
  const selectedMedia = new Set(mediaIds);
  const events = new Set<string>();
  const deliveries = new Set<string>();
  const attempts = new Set<string>();
  const client = queryFixtureDatabase(db, {
    query: {
      retentionDecision: {
        async create({ args, query }) {
          if (
            args.data.mediaId !== undefined &&
            selectedMedia.has(args.data.mediaId)
          )
            args.data.createdAt = historical();
          return query(args);
        },
      },
      applicationEvent: {
        async create({ args, query }) {
          const selected =
            args.data.mediaId != null &&
            selectedMedia.has(args.data.mediaId) &&
            args.data.kind === "retention_warning";
          if (selected) args.data.createdAt = historical();
          const row = await query(args);
          if (selected) events.add(z.uuid().parse(row.id));
          return row;
        },
      },
      notificationDelivery: {
        async create({ args, query }) {
          const selected =
            args.data.eventId !== undefined && events.has(args.data.eventId);
          if (selected) args.data.createdAt = historical();
          const row = await query(args);
          if (selected) deliveries.add(z.uuid().parse(row.id));
          return row;
        },
        async update({ args, query }) {
          if (
            deliveries.has(args.where.id ?? "") &&
            args.data.acceptedAt instanceof Date
          )
            args.data.acceptedAt = historical();
          return query(args);
        },
      },
      notificationDeliveryAttempt: {
        async create({ args, query }) {
          const selected =
            args.data.deliveryId !== undefined &&
            deliveries.has(args.data.deliveryId);
          if (selected) args.data.startedAt = historical();
          const row = await query(args);
          if (selected) attempts.add(z.uuid().parse(row.id));
          return row;
        },
        async update({ args, query }) {
          if (
            attempts.has(args.where.id ?? "") &&
            args.data.finishedAt instanceof Date
          )
            args.data.finishedAt = historical();
          return query(args);
        },
      },
    },
  });
  return client;
}

export async function warningHistory(db: Database, decisionId: string) {
  const decision = await db.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  const events = await db.applicationEvent.findMany({
    where: { mediaId: decision.mediaId, kind: "retention_warning" },
    orderBy: { id: "asc" },
  });
  const deliveries = await db.notificationDelivery.findMany({
    where: { eventId: { in: events.map((row) => row.id) } },
    orderBy: { id: "asc" },
  });
  const attempts = await db.notificationDeliveryAttempt.findMany({
    where: { deliveryId: { in: deliveries.map((row) => row.id) } },
    orderBy: { id: "asc" },
  });
  for (const delivery of deliveries) {
    const event = events.find((row) => row.id === delivery.eventId);
    const attempt = attempts.find((row) => row.deliveryId === delivery.id);
    if (
      event === undefined ||
      attempt === undefined ||
      delivery.acceptedAt === null ||
      attempt.finishedAt === null ||
      decision.createdAt > event.createdAt ||
      event.createdAt > delivery.createdAt ||
      delivery.createdAt > attempt.startedAt ||
      attempt.startedAt > delivery.acceptedAt ||
      attempt.finishedAt < attempt.startedAt
    )
      throw new Error("Simulated elapsed warning chronology is inconsistent");
  }
  return {
    projection: await db.retentionPlexProjection.findUniqueOrThrow({
      where: { decisionId },
    }),
    events,
    deliveries: deliveries.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      userId: row.userId,
      channel: row.channel,
      providerReceipt: row.providerReceipt,
      acceptedAt: row.acceptedAt,
      createdAt: row.createdAt,
    })),
    attempts: attempts.map((row) => ({
      id: row.id,
      deliveryId: row.deliveryId,
      attemptNumber: row.attemptNumber,
      recoveryEpoch: row.recoveryEpoch,
      recipientFingerprint: row.recipientFingerprint,
      startedAt: row.startedAt,
      providerReceipt: row.providerReceipt,
    })),
  };
}

export async function assertWarningHistory(
  db: Database,
  decisionId: string,
  original: Awaited<ReturnType<typeof warningHistory>>,
) {
  if (!isDeepStrictEqual(await warningHistory(db, decisionId), original))
    throw new Error(
      "Fresh retention evaluation rewrote original warning evidence",
    );
}
