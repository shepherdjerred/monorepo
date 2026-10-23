import { z } from "zod";

import {
  AlertEventRecordSchema,
  AlertOccurrenceRecordSchema,
  observedLastSeenAtNs,
  type AlertOccurrenceRecord,
} from "#domain/alert";
import { AlertEventIdSchema } from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";

const JsonObjectSchema = z.record(z.string(), z.unknown());

export type OccurrenceRow = {
  id: string;
  source: string;
  fingerprint: string;
  startedAtNs: bigint;
  openedAtNs: bigint;
  resolvedAtNs: bigint | null;
  lastSeenAtNs: bigint;
  missingSinceNs: bigint | null;
  absentSnapshots: number;
  firstNotifiedAtNs: bigint | null;
  lifecycleState: string;
  suppressionState: string;
  resolutionSource: string | null;
  alertname: string;
  namespace: string | null;
  severity: string;
  summary: string;
  generatorUrl: string | null;
  labels: unknown;
  annotations: unknown;
};

export function parseOccurrence(row: OccurrenceRow): AlertOccurrenceRecord {
  return AlertOccurrenceRecordSchema.parse(row);
}

/**
 * `latestSnapshotCompletedAtNs` is the latest successful reconciliation, which
 * stands in for the last-seen instant of every occurrence it observed.
 */
export function toAlertView(
  row: OccurrenceRow,
  latestSnapshotCompletedAtNs: bigint | null,
) {
  const alert = parseOccurrence(row);
  return {
    id: alert.id,
    fingerprint: alert.fingerprint,
    alertname: alert.alertname,
    namespace: alert.namespace,
    severity: alert.severity,
    summary: alert.summary,
    lifecycleState: alert.lifecycleState,
    suppressionState: alert.suppressionState,
    resolutionSource: alert.resolutionSource,
    openedAt: epochNanosecondsToInstantText(alert.openedAtNs),
    resolvedAt:
      alert.resolvedAtNs === null
        ? null
        : epochNanosecondsToInstantText(alert.resolvedAtNs),
    lastSeenAt: epochNanosecondsToInstantText(
      observedLastSeenAtNs(alert, latestSnapshotCompletedAtNs),
    ),
    generatorUrl: alert.generatorUrl,
    labels: alert.labels,
    annotations: alert.annotations,
  };
}

export function toEventView(row: {
  id: string;
  occurrenceId: string;
  type: string;
  occurredAtNs: bigint;
  source: string;
  detail: unknown;
}) {
  const event = AlertEventRecordSchema.parse({
    ...row,
    detail: row.detail === null ? null : JsonObjectSchema.parse(row.detail),
  });
  return {
    id: AlertEventIdSchema.parse(event.id),
    occurrenceId: event.occurrenceId,
    type: event.type,
    occurredAt: epochNanosecondsToInstantText(event.occurredAtNs),
    source: event.source,
    detail: event.detail,
  };
}
