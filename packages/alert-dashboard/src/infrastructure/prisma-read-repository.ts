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
  type EventListInput,
  type EventListResponse,
  type Summary,
  type SystemStatus,
} from "#shared/schema";
import {
  durationMilliseconds,
  epochNanosecondsToInstantText,
  instantTextToEpochNanoseconds,
} from "#shared/time";

function alertWhere(input: AlertListInput): Prisma.AlertOccurrenceWhereInput {
  const predicates: Prisma.AlertOccurrenceWhereInput[] = [];
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
        { summary: { contains: input.search, mode: "insensitive" } },
        { alertname: { contains: input.search, mode: "insensitive" } },
        { fingerprint: { contains: input.search, mode: "insensitive" } },
        { namespace: { contains: input.search, mode: "insensitive" } },
      ],
    });
  for (const [key, value] of Object.entries(input.label ?? {}))
    predicates.push({ labels: { path: [key], equals: value } });
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
      ...(input.severity === undefined ? {} : { severity: input.severity }),
      ...(input.alertname === undefined ? {} : { alertname: input.alertname }),
      ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
    },
  });
  return { AND: predicates };
}

export class PrismaReadRepository {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async listAlerts(input: AlertListInput): Promise<AlertListResponse> {
    const rows = await this.#prisma.alertOccurrence.findMany({
      where: alertWhere(input),
      orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor === undefined
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, input.limit);
    return AlertListResponseSchema.parse({
      items: page.map((row) => toAlertView(row)),
      nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
    });
  }

  async getAlert(input: AlertDetailInput): Promise<AlertDetail | null> {
    const [row, deliveries] = await Promise.all([
      this.#prisma.alertOccurrence.findUnique({
        where: { id: input.id },
        include: {
          events: { orderBy: [{ occurredAtNs: "asc" }, { id: "asc" }] },
        },
      }),
      this.#prisma.webhookDelivery.findMany({
        where: { occurrenceIds: { array_contains: [input.id] } },
        orderBy: [{ receivedAtNs: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor === undefined
          ? {}
          : { cursor: { id: input.cursor }, skip: 1 }),
      }),
    ]);
    if (row === null) return null;
    const deliveryPage = deliveries.slice(0, input.limit);
    return AlertDetailSchema.parse({
      ...toAlertView(row),
      events: row.events.map((event) => toEventView(event)),
      deliveries: deliveryPage.map((delivery) => ({
        id: delivery.id,
        receivedAt: epochNanosecondsToInstantText(delivery.receivedAtNs),
        groupKey: delivery.groupKey,
        status: delivery.status,
        receiver: delivery.receiver,
        notificationReason: delivery.notificationReason,
        payloadHash: delivery.payloadHash,
        rawPayloadRetained: delivery.rawPayload !== null,
        rawExpiresAt: epochNanosecondsToInstantText(delivery.rawExpiresAtNs),
      })),
      deliveriesNextCursor:
        deliveries.length > input.limit
          ? (deliveryPage.at(-1)?.id ?? null)
          : null,
    });
  }

  async listEvents(input: EventListInput): Promise<EventListResponse> {
    const rows = await this.#prisma.alertEvent.findMany({
      where: eventWhere(input),
      include: { occurrence: true },
      orderBy: [{ occurredAtNs: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor === undefined
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, input.limit);
    return EventListResponseSchema.parse({
      items: page.map((row) => ({
        ...toEventView(row),
        alert: toAlertView(row.occurrence),
      })),
      nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
    });
  }

  async summary(): Promise<Summary> {
    const [
      open,
      resolved,
      critical,
      warning,
      info,
      silenced,
      inhibited,
      unprocessed,
      lastRun,
    ] = await Promise.all([
      this.#prisma.alertOccurrence.count({ where: { lifecycleState: "open" } }),
      this.#prisma.alertOccurrence.count({
        where: { lifecycleState: "resolved" },
      }),
      this.#prisma.alertOccurrence.count({
        where: {
          lifecycleState: "open",
          severity: "critical",
          suppressionState: "none",
        },
      }),
      this.#prisma.alertOccurrence.count({
        where: {
          lifecycleState: "open",
          severity: "warning",
          suppressionState: "none",
        },
      }),
      this.#prisma.alertOccurrence.count({
        where: {
          lifecycleState: "open",
          severity: "info",
          suppressionState: "none",
        },
      }),
      this.#prisma.alertOccurrence.count({
        where: { lifecycleState: "open", suppressionState: "silenced" },
      }),
      this.#prisma.alertOccurrence.count({
        where: { lifecycleState: "open", suppressionState: "inhibited" },
      }),
      this.#prisma.alertOccurrence.count({
        where: { lifecycleState: "open", suppressionState: "unprocessed" },
      }),
      this.#prisma.snapshotRun.findFirst({
        where: { status: "success" },
        orderBy: { completedAtNs: "desc" },
      }),
    ]);
    return SummarySchema.parse({
      open,
      resolved,
      critical,
      warning,
      info,
      silenced,
      inhibited,
      unprocessed,
      lastReconciledAt:
        lastRun === null
          ? null
          : epochNanosecondsToInstantText(lastRun.completedAtNs),
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
      this.#prisma.emailOutbox.count({ where: { sentAtNs: null } }),
      this.#prisma.emailOutbox.count({
        where: { sentAtNs: null, lastError: { not: null } },
      }),
      this.#prisma.emailOutbox.findFirst({
        where: { sentAtNs: null },
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
      postal: emailEnabled ? (failedEmails > 0 ? "error" : "ok") : "disabled",
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
