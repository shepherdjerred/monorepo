import { z } from "zod";

import type { Prisma, PrismaClient } from "#generated/prisma/client/index.js";
import { toAlertView, toEventView } from "#infrastructure/prisma-mappers";
import {
  AlertDetailSchema,
  AlertListResponseSchema,
  EventListResponseSchema,
  SummarySchema,
  SystemStatusSchema,
  type AlertDetail,
  type AlertDetailInput,
  type AlertListInput,
  type AlertListResponse,
  type AlertScope,
  type EventListInput,
  type EventListResponse,
  type Summary,
  type SummaryInput,
  type SystemStatus,
} from "#shared/schema";
import {
  durationMilliseconds,
  epochNanosecondsToInstantText,
  instantTextToEpochNanoseconds,
} from "#shared/time";

function scopeWhere(
  scope: AlertScope | undefined,
): Prisma.AlertOccurrenceWhereInput {
  if (scope === "house") {
    return { labelEntries: { some: { key: "category", value: "household" } } };
  }
  return scope === "ops"
    ? { labelEntries: { none: { key: "category", value: "household" } } }
    : {};
}

const DeliveryScalarRowsSchema = z.array(
  z.object({
    id: z.string(),
    receivedAtNs: z.coerce.bigint(),
    groupKey: z.string(),
    status: z.string(),
    receiver: z.string(),
    truncatedAlerts: z.coerce.number().int().nonnegative(),
    notificationReason: z.string().nullable(),
    payloadHash: z.string(),
    rawPayloadRetained: z
      .union([z.boolean(), z.bigint(), z.number()])
      .transform((value) =>
        typeof value === "boolean" ? value : Number(value) !== 0,
      ),
    rawExpiresAtNs: z.coerce.bigint(),
  }),
);

type OccurrenceGroupCount = {
  lifecycleState: string;
  severity: string;
  suppressionState: string;
  _count: { _all: number };
};

function accumulateSummaryCounts(groups: readonly OccurrenceGroupCount[]) {
  const totals = {
    open: 0,
    resolved: 0,
    critical: 0,
    warning: 0,
    info: 0,
    silenced: 0,
    inhibited: 0,
    unprocessed: 0,
  };
  for (const group of groups) {
    const count = group._count._all;
    if (group.lifecycleState === "resolved") {
      totals.resolved += count;
      continue;
    }
    if (group.lifecycleState !== "open") continue;
    switch (group.suppressionState) {
      case "none":
        totals.open += count;
        switch (group.severity) {
          case "critical":
            totals.critical += count;
            break;
          case "warning":
            totals.warning += count;
            break;
          case "info":
            totals.info += count;
            break;
          default:
            break;
        }
        break;
      case "silenced":
        totals.silenced += count;
        break;
      case "inhibited":
        totals.inhibited += count;
        break;
      case "unprocessed":
        totals.unprocessed += count;
        break;
      default:
        break;
    }
  }
  return totals;
}

function alertWhere(input: AlertListInput): Prisma.AlertOccurrenceWhereInput {
  const predicates: Prisma.AlertOccurrenceWhereInput[] = [];
  if (input.scope !== undefined && input.scope !== "all")
    predicates.push(scopeWhere(input.scope));
  if (input.lifecycleState !== undefined)
    predicates.push({ lifecycleState: input.lifecycleState });
  if (input.suppressionState !== undefined)
    predicates.push({ suppressionState: input.suppressionState });
  if (input.severity !== undefined)
    predicates.push({ severity: input.severity });
  if (input.alertname !== undefined)
    predicates.push({ alertname: input.alertname });
  if (input.namespace !== undefined)
    predicates.push({ namespace: input.namespace });
  if (input.openedFrom !== undefined)
    predicates.push({
      openedAtNs: { gte: instantTextToEpochNanoseconds(input.openedFrom) },
    });
  if (input.openedTo !== undefined)
    predicates.push({
      openedAtNs: { lte: instantTextToEpochNanoseconds(input.openedTo) },
    });
  if (input.resolvedFrom !== undefined)
    predicates.push({
      resolvedAtNs: { gte: instantTextToEpochNanoseconds(input.resolvedFrom) },
    });
  if (input.resolvedTo !== undefined)
    predicates.push({
      resolvedAtNs: { lte: instantTextToEpochNanoseconds(input.resolvedTo) },
    });
  if (input.search !== undefined)
    predicates.push({
      OR: [
        { summary: { contains: input.search } },
        { alertname: { contains: input.search } },
        { fingerprint: { contains: input.search } },
        { namespace: { contains: input.search } },
      ],
    });
  for (const [key, value] of Object.entries(input.label ?? {}))
    predicates.push({ labelEntries: { some: { key, value } } });
  return { AND: predicates };
}

function eventWhere(input: EventListInput): Prisma.AlertEventWhereInput {
  const predicates: Prisma.AlertEventWhereInput[] = [];
  if (input.type !== undefined) predicates.push({ type: input.type });
  if (input.from !== undefined)
    predicates.push({
      occurredAtNs: { gte: instantTextToEpochNanoseconds(input.from) },
    });
  if (input.to !== undefined)
    predicates.push({
      occurredAtNs: { lte: instantTextToEpochNanoseconds(input.to) },
    });
  predicates.push({
    occurrence: {
      ...scopeWhere(input.scope),
      ...(input.severity === undefined ? {} : { severity: input.severity }),
      ...(input.alertname === undefined ? {} : { alertname: input.alertname }),
      ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
    },
  });
  return { AND: predicates };
}

/** Fetches one extra row so a full page can tell whether another follows. */
function pageWindow(input: { limit: number; cursor?: string | undefined }): {
  take: number;
  cursor?: { id: string };
  skip?: number;
} {
  return {
    take: input.limit + 1,
    ...(input.cursor === undefined
      ? {}
      : { cursor: { id: input.cursor }, skip: 1 }),
  };
}

function nextCursor(
  rows: readonly { id: string }[],
  limit: number,
): string | null {
  return rows.length > limit ? (rows[limit - 1]?.id ?? null) : null;
}

export class PrismaReadRepository {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** Completion of the latest successful snapshot run; see `toAlertView`. */
  async #latestSnapshotCompletedAtNs(): Promise<bigint | null> {
    const run = await this.#prisma.snapshotRun.findFirst({
      where: { status: "success" },
      orderBy: { completedAtNs: "desc" },
      select: { completedAtNs: true },
    });
    return run?.completedAtNs ?? null;
  }

  /**
   * Projects scalar delivery columns and evaluates `rawPayload IS NOT NULL` in
   * SQLite so multi-KB `rawPayload` JSON blobs are never transferred or parsed
   * in JS. Applies the same `(receivedAtNs DESC, id DESC)` cursor window as
   * `pageWindow`.
   */
  async #listAlertDeliveries(input: AlertDetailInput) {
    const take = input.limit + 1;
    const rawRows =
      input.cursor === undefined
        ? await this.#prisma.$queryRaw`
            SELECT
              d."id",
              d."receivedAtNs",
              d."groupKey",
              d."status",
              d."receiver",
              d."truncatedAlerts",
              d."notificationReason",
              d."payloadHash",
              CASE WHEN d."rawPayload" IS NOT NULL THEN 1 ELSE 0 END AS "rawPayloadRetained",
              d."rawExpiresAtNs"
            FROM "WebhookDeliveryOccurrence" link
            INNER JOIN "WebhookDelivery" d ON d."id" = link."deliveryId"
            WHERE link."occurrenceId" = ${input.id}
            ORDER BY d."receivedAtNs" DESC, d."id" DESC
            LIMIT ${take}
          `
        : await this.#prisma.$queryRaw`
            SELECT
              d."id",
              d."receivedAtNs",
              d."groupKey",
              d."status",
              d."receiver",
              d."truncatedAlerts",
              d."notificationReason",
              d."payloadHash",
              CASE WHEN d."rawPayload" IS NOT NULL THEN 1 ELSE 0 END AS "rawPayloadRetained",
              d."rawExpiresAtNs"
            FROM "WebhookDeliveryOccurrence" link
            INNER JOIN "WebhookDelivery" d ON d."id" = link."deliveryId"
            INNER JOIN (
              SELECT cd."receivedAtNs", cd."id"
              FROM "WebhookDeliveryOccurrence" clink
              INNER JOIN "WebhookDelivery" cd ON cd."id" = clink."deliveryId"
              WHERE clink."occurrenceId" = ${input.id}
                AND cd."id" = ${input.cursor}
            ) cursor_row ON (
              d."receivedAtNs" < cursor_row."receivedAtNs"
              OR (
                d."receivedAtNs" = cursor_row."receivedAtNs"
                AND d."id" < cursor_row."id"
              )
            )
            WHERE link."occurrenceId" = ${input.id}
            ORDER BY d."receivedAtNs" DESC, d."id" DESC
            LIMIT ${take}
          `;
    return DeliveryScalarRowsSchema.parse(rawRows);
  }

  async listAlerts(input: AlertListInput): Promise<AlertListResponse> {
    const [rows, latestSnapshotNs] = await Promise.all([
      this.#prisma.alertOccurrence.findMany({
        where: alertWhere(input),
        orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
        ...pageWindow(input),
      }),
      this.#latestSnapshotCompletedAtNs(),
    ]);
    const page = rows.slice(0, input.limit);
    return AlertListResponseSchema.parse({
      items: page.map((row) => toAlertView(row, latestSnapshotNs)),
      nextCursor: nextCursor(rows, input.limit),
    });
  }

  async getAlert(input: AlertDetailInput): Promise<AlertDetail | null> {
    const [row, deliveries, latestSnapshotNs] = await Promise.all([
      this.#prisma.alertOccurrence.findUnique({
        where: { id: input.id },
        include: {
          events: { orderBy: [{ occurredAtNs: "asc" }, { id: "asc" }] },
        },
      }),
      this.#listAlertDeliveries(input),
      this.#latestSnapshotCompletedAtNs(),
    ]);
    if (row === null) return null;
    const deliveryPage = deliveries.slice(0, input.limit);
    return AlertDetailSchema.parse({
      ...toAlertView(row, latestSnapshotNs),
      events: row.events.map((event) => toEventView(event)),
      deliveries: deliveryPage.map((delivery) => ({
        id: delivery.id,
        receivedAt: epochNanosecondsToInstantText(delivery.receivedAtNs),
        groupKey: delivery.groupKey,
        status: delivery.status,
        receiver: delivery.receiver,
        truncatedAlerts: delivery.truncatedAlerts,
        notificationReason: delivery.notificationReason,
        payloadHash: delivery.payloadHash,
        rawPayloadRetained: delivery.rawPayloadRetained,
        rawExpiresAt: epochNanosecondsToInstantText(delivery.rawExpiresAtNs),
      })),
      deliveriesNextCursor: nextCursor(deliveries, input.limit),
    });
  }

  async listEvents(input: EventListInput): Promise<EventListResponse> {
    const [rows, latestSnapshotNs] = await Promise.all([
      this.#prisma.alertEvent.findMany({
        where: eventWhere(input),
        include: { occurrence: true },
        orderBy: [{ occurredAtNs: "desc" }, { id: "desc" }],
        ...pageWindow(input),
      }),
      this.#latestSnapshotCompletedAtNs(),
    ]);
    const page = rows.slice(0, input.limit);
    return EventListResponseSchema.parse({
      items: page.map((row) => ({
        ...toEventView(row),
        alert: toAlertView(row.occurrence, latestSnapshotNs),
      })),
      nextCursor: nextCursor(rows, input.limit),
    });
  }

  async summary(input?: SummaryInput): Promise<Summary> {
    const [groups, latestSnapshotNs] = await Promise.all([
      this.#prisma.alertOccurrence.groupBy({
        where: scopeWhere(input?.scope),
        by: ["lifecycleState", "severity", "suppressionState"],
        _count: { _all: true },
      }),
      this.#latestSnapshotCompletedAtNs(),
    ]);
    return SummarySchema.parse({
      ...accumulateSummaryCounts(groups),
      lastReconciledAt:
        latestSnapshotNs === null
          ? null
          : epochNanosecondsToInstantText(latestSnapshotNs),
    });
  }

  async systemStatus(
    emailEnabled: boolean,
    nowNs: bigint,
  ): Promise<SystemStatus> {
    const [
      lastRun,
      lastSuccessfulRun,
      pendingEmails,
      failedEmails,
      oldestPendingEmail,
    ] = await Promise.all([
      this.#prisma.snapshotRun.findFirst({
        orderBy: { completedAtNs: "desc" },
      }),
      this.#prisma.snapshotRun.findFirst({
        where: { status: "success" },
        orderBy: { completedAtNs: "desc" },
      }),
      this.#prisma.emailOutbox.count({
        where: { sentAtNs: null, canceledAtNs: null },
      }),
      this.#prisma.emailOutbox.count({
        where: {
          sentAtNs: null,
          canceledAtNs: null,
          lastError: { not: null },
        },
      }),
      this.#prisma.emailOutbox.findFirst({
        where: { sentAtNs: null, canceledAtNs: null },
        orderBy: { createdAtNs: "asc" },
        select: { createdAtNs: true },
      }),
    ]);
    let alertmanager: "ok" | "stale" | "error" | "pending" = "pending";
    if (lastRun?.status === "error") alertmanager = "error";
    else if (
      lastRun !== null &&
      durationMilliseconds(lastRun.completedAtNs, nowNs) > 60_000
    )
      alertmanager = "stale";
    else if (lastRun !== null) alertmanager = "ok";
    return SystemStatusSchema.parse({
      database: "ok",
      alertmanager,
      grafana: "pending",
      mail: emailEnabled ? (failedEmails > 0 ? "error" : "ok") : "disabled",
      emailEnabled,
      pendingEmails,
      failedEmails,
      oldestPendingEmailAt:
        oldestPendingEmail === null
          ? null
          : epochNanosecondsToInstantText(oldestPendingEmail.createdAtNs),
      lastReconciledAt:
        lastSuccessfulRun === null
          ? null
          : epochNanosecondsToInstantText(lastSuccessfulRun.completedAtNs),
    });
  }
}
