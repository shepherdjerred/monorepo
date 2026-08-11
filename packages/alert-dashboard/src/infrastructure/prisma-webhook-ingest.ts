import {
  type AlertOccurrence,
  type Prisma,
} from "#generated/prisma/client/index.js";
import {
  eventId,
  normalizeGeneratorUrl,
  occurrenceId,
  severityFromLabels,
  summaryFromMetadata,
  type AlertOccurrenceRecord,
} from "#domain/alert";
import { parseOccurrence } from "#infrastructure/prisma-mappers";
import { findWebhookOccurrence } from "#infrastructure/prisma-occurrence";
import { replaceOccurrenceLabels } from "#infrastructure/prisma-labels";
import type { AlertmanagerWebhook } from "#shared/schema";
import { instantTextToEpochNanoseconds } from "#shared/time";

type WebhookAlert = AlertmanagerWebhook["alerts"][number];
type IngestedAlert = {
  occurrenceId: string;
  opened: number;
  resolved: number;
  notified: AlertOccurrenceRecord | null;
};

function resolvedAt(alert: WebhookAlert): bigint | null {
  return alert.status === "resolved"
    ? instantTextToEpochNanoseconds(alert.endsAt)
    : null;
}

function isEligible(alert: WebhookAlert): boolean {
  const severity = severityFromLabels(alert.labels);
  return (
    alert.status === "firing" &&
    (severity === "critical" || severity === "warning")
  );
}

async function createOccurrence(input: {
  transaction: Prisma.TransactionClient;
  alert: WebhookAlert;
  id: string;
  startedAtNs: bigint;
  receivedAtNs: bigint;
}): Promise<IngestedAlert> {
  const { transaction, alert, id, startedAtNs, receivedAtNs } = input;
  const alertResolvedAtNs = resolvedAt(alert);
  const eligible = isEligible(alert);
  const occurrence = await transaction.alertOccurrence.create({
    data: {
      id,
      source: "alertmanager",
      fingerprint: alert.fingerprint,
      startedAtNs,
      openedAtNs: startedAtNs,
      resolvedAtNs: alertResolvedAtNs,
      lastSeenAtNs: receivedAtNs,
      firstNotifiedAtNs: eligible ? receivedAtNs : null,
      lifecycleState: alert.status === "resolved" ? "resolved" : "open",
      suppressionState: "none",
      resolutionSource: alert.status === "resolved" ? "webhook" : null,
      alertname: alert.labels["alertname"] ?? "UnnamedAlert",
      namespace: alert.labels["namespace"] ?? null,
      severity: severityFromLabels(alert.labels),
      summary: summaryFromMetadata(alert.labels, alert.annotations),
      generatorUrl: normalizeGeneratorUrl(alert.generatorURL),
      labels: alert.labels,
      annotations: alert.annotations,
    },
  });
  await replaceOccurrenceLabels(transaction, id, alert.labels);
  await transaction.alertEvent.create({
    data: {
      id: eventId(id, "opened", startedAtNs),
      occurrenceId: id,
      type: "opened",
      occurredAtNs: startedAtNs,
      source: "webhook",
    },
  });
  if (alertResolvedAtNs !== null)
    await transaction.alertEvent.create({
      data: {
        id: eventId(id, "resolved", alertResolvedAtNs),
        occurrenceId: id,
        type: "resolved",
        occurredAtNs: alertResolvedAtNs,
        source: "webhook",
      },
    });
  return {
    occurrenceId: occurrence.id,
    opened: 1,
    resolved: alertResolvedAtNs === null ? 0 : 1,
    notified: eligible ? parseOccurrence(occurrence) : null,
  };
}

function reconciledResolutionPromotion(
  existing: AlertOccurrence,
  alertResolvedAtNs: bigint | null,
): Prisma.AlertOccurrenceUpdateInput {
  if (
    alertResolvedAtNs !== null &&
    existing.lifecycleState === "resolved" &&
    existing.resolutionSource === "reconciled"
  )
    return { resolutionSource: "webhook" };
  return {};
}

function shouldReopenOccurrence(
  alertResolvedAtNs: bigint | null,
  existing: AlertOccurrence,
  startedAtNs: bigint,
): boolean {
  return (
    alertResolvedAtNs === null &&
    existing.lifecycleState === "resolved" &&
    existing.resolutionSource === "reconciled" &&
    (existing.resolvedAtNs === null || startedAtNs > existing.resolvedAtNs)
  );
}

type UpdateOccurrenceInput = {
  transaction: Prisma.TransactionClient;
  alert: WebhookAlert;
  existing: AlertOccurrence;
  startedAtNs: bigint;
  receivedAtNs: bigint;
};

async function updateOccurrence(
  input: UpdateOccurrenceInput,
): Promise<IngestedAlert> {
  const { transaction, alert, existing, startedAtNs, receivedAtNs } = input;
  const alertResolvedAtNs = resolvedAt(alert);
  const shouldReopen = shouldReopenOccurrence(
    alertResolvedAtNs,
    existing,
    startedAtNs,
  );
  const reopenedAtNs =
    shouldReopen &&
    existing.resolvedAtNs !== null &&
    existing.resolvedAtNs >= receivedAtNs
      ? existing.resolvedAtNs + 1n
      : receivedAtNs;
  const shouldNotify =
    isEligible(alert) &&
    (existing.lifecycleState === "open" || shouldReopen) &&
    existing.firstNotifiedAtNs === null;
  const shouldResolve =
    alertResolvedAtNs !== null && existing.lifecycleState !== "resolved";
  const occurrence = await transaction.alertOccurrence.update({
    where: { id: existing.id },
    data: {
      lastSeenAtNs: receivedAtNs,
      missingSinceNs: null,
      absentSnapshots: 0,
      alertname: alert.labels["alertname"] ?? "UnnamedAlert",
      namespace: alert.labels["namespace"] ?? null,
      severity: severityFromLabels(alert.labels),
      summary: summaryFromMetadata(alert.labels, alert.annotations),
      generatorUrl: normalizeGeneratorUrl(alert.generatorURL),
      labels: alert.labels,
      annotations: alert.annotations,
      ...(shouldNotify ? { firstNotifiedAtNs: receivedAtNs } : {}),
      ...(shouldReopen
        ? {
            lifecycleState: "open",
            resolvedAtNs: null,
            resolutionSource: null,
          }
        : {}),
      ...(shouldResolve
        ? {
            lifecycleState: "resolved",
            resolvedAtNs: alertResolvedAtNs,
            resolutionSource: "webhook",
          }
        : {}),
      ...reconciledResolutionPromotion(existing, alertResolvedAtNs),
    },
  });
  await replaceOccurrenceLabels(transaction, existing.id, alert.labels);
  if (shouldResolve)
    await transaction.alertEvent.create({
      data: {
        id: eventId(existing.id, "resolved", alertResolvedAtNs),
        occurrenceId: existing.id,
        type: "resolved",
        occurredAtNs: alertResolvedAtNs,
        source: "webhook",
      },
    });
  if (shouldReopen)
    await transaction.alertEvent.create({
      data: {
        id: eventId(existing.id, "reopened_webhook", reopenedAtNs),
        occurrenceId: existing.id,
        type: "opened",
        occurredAtNs: reopenedAtNs,
        source: "webhook",
        detail: { previousResolutionSource: "reconciled" },
      },
    });
  return {
    occurrenceId: occurrence.id,
    opened: shouldReopen ? 1 : 0,
    resolved: shouldResolve ? 1 : 0,
    notified: shouldNotify ? parseOccurrence(occurrence) : null,
  };
}

export async function ingestWebhookAlert(
  transaction: Prisma.TransactionClient,
  alert: WebhookAlert,
  receivedAtNs: bigint,
): Promise<IngestedAlert> {
  const startedAtNs = instantTextToEpochNanoseconds(alert.startsAt);
  const alertResolvedAtNs = resolvedAt(alert);
  const id = occurrenceId(alert.fingerprint, startedAtNs);
  const existing = await findWebhookOccurrence(
    transaction,
    alert.fingerprint,
    startedAtNs,
    alertResolvedAtNs,
  );
  return existing === null
    ? createOccurrence({ transaction, alert, id, startedAtNs, receivedAtNs })
    : updateOccurrence({
        transaction,
        alert,
        existing,
        startedAtNs,
        receivedAtNs,
      });
}
