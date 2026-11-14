import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type {
  NotificationDelivery,
  NotificationDeliveryAttempt,
} from "#generated/prisma/client.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";

const historical = () => new Date(Date.now() - 8 * 86_400_000);
type FixtureQueryHooks = Parameters<typeof queryFixtureDatabase>[1]["query"];

function selectedNoticeDeliveryBirth(
  events: Set<string>,
  deliveries: Set<string>,
  createdAt: () => Date,
) {
  const hooks = {
    notificationDelivery: {
      create: async ({ args, query }) => {
        const selected =
          args.data.eventId !== undefined && events.has(args.data.eventId);
        if (selected) args.data.createdAt = createdAt();
        const row = await query(args);
        if (selected) deliveries.add(z.uuid().parse(row.id));
        return row;
      },
    },
  } satisfies FixtureQueryHooks;
  return hooks.notificationDelivery.create;
}

function firstNoticeAcceptance(
  deliveries: Set<string>,
  accepted: Set<string>,
  acceptedAt: () => Date,
) {
  const write = z.object({ acceptedAt: z.instanceof(Date) });
  const hooks = {
    notificationDelivery: {
      update: async ({ args, query }) => {
        const id = args.where.id ?? "";
        if (
          deliveries.has(id) &&
          !accepted.has(id) &&
          write.safeParse(args.data).success
        ) {
          args.data.acceptedAt = acceptedAt();
          accepted.add(id);
        }
        return query(args);
      },
    },
  } satisfies FixtureQueryHooks;
  return hooks.notificationDelivery.update;
}

/** Simulated original interest-notice birth/receipt sequence; never rewrites an accepted receipt. */
export function elapsedInterestNoticeQueries(
  events: Set<string>,
  noticeAt: Date,
) {
  const deliveries = new Set<string>(),
    accepted = new Set<string>();
  return {
    notificationDelivery: {
      create: selectedNoticeDeliveryBirth(
        events,
        deliveries,
        () => new Date(noticeAt.getTime() + 1),
      ),
      update: firstNoticeAcceptance(
        deliveries,
        accepted,
        () => new Date(noticeAt.getTime() + 3),
      ),
    },
    notificationDeliveryAttempt: {
      async create({ args, query }) {
        if (
          args.data.deliveryId !== undefined &&
          deliveries.has(args.data.deliveryId)
        )
          args.data.startedAt = new Date(noticeAt.getTime() + 2);
        return query(args);
      },
    },
  } satisfies FixtureQueryHooks;
}

/** Simulated elapsed grace at original producer writes, never a clock or authority override. */
export function elapsedWarningClient(
  db: Database,
  mediaIds: readonly string[],
) {
  const selectedMedia = new Set(mediaIds);
  const events = new Set<string>();
  const deliveries = new Set<string>();
  const attempts = new Set<string>();
  const acceptedDeliveries = new Set<string>();
  const startedDeliveries = new Set<string>();
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
        create: selectedNoticeDeliveryBirth(events, deliveries, historical),
        update: firstNoticeAcceptance(
          deliveries,
          acceptedDeliveries,
          historical,
        ),
      },
      notificationDeliveryAttempt: {
        async create({ args, query }) {
          const selected =
            args.data.deliveryId !== undefined &&
            deliveries.has(args.data.deliveryId) &&
            !startedDeliveries.has(args.data.deliveryId);
          if (selected) {
            args.data.startedAt = historical();
            startedDeliveries.add(z.uuid().parse(args.data.deliveryId));
          }
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

/** These fixtures deliberately prove private provider acceptance. In-app
 * reminders remain unread and never acquire a fabricated provider send. */
export async function pendingInAppWarningHistory(
  db: Database,
  eventIds: string[],
) {
  const rows = await db.notificationDelivery.findMany({
    where: { eventId: { in: eventIds }, channel: "in_app" },
    orderBy: { id: "asc" },
  });
  if (
    rows.length === 0 ||
    rows.some(
      (row) =>
        row.state !== "pending" ||
        row.acceptedAt !== null ||
        row.providerReceipt !== null ||
        row.providerStatus !== null ||
        row.reconciledAt !== null ||
        row.recipientFingerprint !== null ||
        row.attempts !== 0,
    )
  )
    throw new Error(
      "Unread in-app warnings changed without their recipient command",
    );
  const ids = rows.map((row) => row.id);
  if (
    (await db.notificationDeliveryAttempt.count({
      where: { deliveryId: { in: ids } },
    })) ||
    (await db.operation.count({
      where: { kind: "deliver_notification", targetId: { in: ids } },
    }))
  )
    throw new Error(
      "In-app warnings cannot have provider attempts or send operations",
    );
  return rows;
}

function requireCurrentPrivateReceipt(
  delivery: NotificationDelivery,
  attempt: NotificationDeliveryAttempt | undefined,
) {
  if (
    attempt === undefined ||
    delivery.state !== "accepted" ||
    attempt.state !== "accepted" ||
    delivery.providerReceipt === null ||
    delivery.providerReceipt !== attempt.providerReceipt ||
    delivery.recipientFingerprint !== attempt.recipientFingerprint ||
    delivery.recoveryEpoch !== attempt.recoveryEpoch ||
    delivery.providerStatus !== "delivered" ||
    delivery.reconciledAt === null ||
    delivery.reconciledAt.getTime() > Date.now() ||
    Date.now() - delivery.reconciledAt.getTime() > 60_000
  )
    throw new Error(
      "Actual private warning receipt is not current and accepted",
    );
  return attempt;
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
  const inApp = await pendingInAppWarningHistory(
    db,
    events.map((row) => row.id),
  );
  const privateDeliveries = deliveries.filter(
    (row) => row.channel !== "in_app",
  );
  if (privateDeliveries.length === 0)
    throw new Error(
      "Retention fixture requires actual accepted private delivery",
    );
  const attempts = await db.notificationDeliveryAttempt.findMany({
    where: { deliveryId: { in: deliveries.map((row) => row.id) } },
    orderBy: { id: "asc" },
  });
  for (const delivery of privateDeliveries) {
    const event = events.find((row) => row.id === delivery.eventId);
    const attempt = requireCurrentPrivateReceipt(
      delivery,
      attempts.find((row) => row.deliveryId === delivery.id),
    );
    if (
      event === undefined ||
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
    inApp,
    deliveries: privateDeliveries.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      userId: row.userId,
      channel: row.channel,
      state: row.state,
      recipientFingerprint: row.recipientFingerprint,
      providerStatus: row.providerStatus,
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
