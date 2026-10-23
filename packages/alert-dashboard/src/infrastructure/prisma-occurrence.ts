import type {
  AlertOccurrence,
  Prisma,
} from "#generated/prisma/client/index.js";
import {
  normalizeGeneratorUrl,
  sameStringMap,
  severityFromLabels,
  summaryFromMetadata,
} from "#domain/alert";
import { LabelMapSchema } from "#shared/schema";

type ObservedAlert = {
  labels: Readonly<Record<string, string>>;
  annotations: Readonly<Record<string, string>>;
  generatorURL?: string | undefined;
};

/** Occurrence columns derived from an Alertmanager observation. */
export function observedFields(alert: ObservedAlert) {
  return {
    alertname: alert.labels["alertname"] ?? "UnnamedAlert",
    namespace: alert.labels["namespace"] ?? null,
    severity: severityFromLabels(alert.labels),
    summary: summaryFromMetadata(alert.labels, alert.annotations),
    generatorUrl: normalizeGeneratorUrl(alert.generatorURL),
    labels: { ...alert.labels },
    annotations: { ...alert.annotations },
  };
}

export type ObservedChanges = {
  data: Prisma.AlertOccurrenceUpdateInput;
  labelsChanged: boolean;
};

/**
 * The observed columns that differ from the stored occurrence. An empty `data`
 * means the observation carries nothing new, so the row need not be written.
 */
export function observedChanges(
  existing: AlertOccurrence,
  alert: ObservedAlert,
): ObservedChanges {
  const next = observedFields(alert);
  const data: Prisma.AlertOccurrenceUpdateInput = {};
  if (existing.alertname !== next.alertname) data.alertname = next.alertname;
  if (existing.namespace !== next.namespace) data.namespace = next.namespace;
  if (existing.severity !== next.severity) data.severity = next.severity;
  if (existing.summary !== next.summary) data.summary = next.summary;
  if (existing.generatorUrl !== next.generatorUrl)
    data.generatorUrl = next.generatorUrl;
  const labelsChanged = !sameStringMap(
    LabelMapSchema.parse(existing.labels),
    next.labels,
  );
  if (labelsChanged) data.labels = next.labels;
  if (
    !sameStringMap(LabelMapSchema.parse(existing.annotations), next.annotations)
  )
    data.annotations = next.annotations;
  return { data, labelsChanged };
}

export async function findObservedOccurrence(
  transaction: Prisma.TransactionClient,
  fingerprint: string,
  startedAtNs: bigint,
): Promise<AlertOccurrence | null> {
  const exact = await transaction.alertOccurrence.findUnique({
    where: {
      source_fingerprint_startedAtNs: {
        source: "alertmanager",
        fingerprint,
        startedAtNs,
      },
    },
  });
  if (exact !== null) return exact;
  return transaction.alertOccurrence.findFirst({
    where: {
      source: "alertmanager",
      fingerprint,
      lifecycleState: "open",
    },
    orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
  });
}

export async function findWebhookOccurrence(
  transaction: Prisma.TransactionClient,
  fingerprint: string,
  startedAtNs: bigint,
  alertResolvedAtNs: bigint | null,
): Promise<AlertOccurrence | null> {
  const exact = await transaction.alertOccurrence.findUnique({
    where: {
      source_fingerprint_startedAtNs: {
        source: "alertmanager",
        fingerprint,
        startedAtNs,
      },
    },
  });
  if (exact !== null) return exact;

  const open = await transaction.alertOccurrence.findFirst({
    where: {
      source: "alertmanager",
      fingerprint,
      lifecycleState: "open",
      ...(alertResolvedAtNs === null
        ? {}
        : { openedAtNs: { lte: alertResolvedAtNs } }),
    },
    orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
  });
  if (open !== null) return open;

  // Push-based producers can refresh startsAt on every send. Once an occurrence
  // is closed, exact/open matching cannot attach delayed retries. A resolved
  // retry first matches the prior row's resolution instant, then may promote a
  // temporally eligible reconciled row. A firing retry may attach only when its
  // start predates the stored resolution.
  if (alertResolvedAtNs !== null) {
    const resolved = await transaction.alertOccurrence.findFirst({
      where: {
        source: "alertmanager",
        fingerprint,
        lifecycleState: "resolved",
        openedAtNs: { lte: alertResolvedAtNs },
        resolvedAtNs: alertResolvedAtNs,
      },
      orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
    });
    if (resolved !== null) return resolved;
    return transaction.alertOccurrence.findFirst({
      where: {
        source: "alertmanager",
        fingerprint,
        lifecycleState: "resolved",
        resolutionSource: "reconciled",
        openedAtNs: { lte: alertResolvedAtNs },
      },
      orderBy: [
        { resolvedAtNs: "desc" },
        { openedAtNs: "desc" },
        { id: "desc" },
      ],
    });
  }
  return transaction.alertOccurrence.findFirst({
    where: {
      source: "alertmanager",
      fingerprint,
      lifecycleState: "resolved",
      resolvedAtNs: { gte: startedAtNs },
    },
    orderBy: [{ resolvedAtNs: "desc" }, { openedAtNs: "desc" }, { id: "desc" }],
  });
}
