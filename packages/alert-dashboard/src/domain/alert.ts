import {
  buildAlertOpeningDocument,
  buildAlertTruncationDocument,
} from "@shepherdjerred/ops-model/email/alert-context.ts";
import { renderEmailHtml } from "@shepherdjerred/ops-model/email/render-html.ts";
import { renderEmailText } from "@shepherdjerred/ops-model/email/render-text.ts";
import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { z } from "zod";

import {
  AlertEventIdSchema,
  AlertFingerprintSchema,
  AlertOccurrenceIdSchema,
  AlertmanagerGeneratorUrlSchema,
  LabelMapSchema,
  LifecycleStateSchema,
  ResolutionSourceSchema,
  SeveritySchema,
  SuppressionStateSchema,
  type AlertmanagerSnapshotAlert,
} from "#shared/schema";
import {
  epochNanosecondsToInstantText,
  instantTextToEpochNanoseconds,
} from "#shared/time";

export const AlertOccurrenceRecordSchema = z.object({
  id: AlertOccurrenceIdSchema,
  source: z.literal("alertmanager"),
  fingerprint: AlertFingerprintSchema,
  startedAtNs: z.bigint(),
  openedAtNs: z.bigint(),
  resolvedAtNs: z.bigint().nullable(),
  lastSeenAtNs: z.bigint(),
  missingSinceNs: z.bigint().nullable(),
  absentSnapshots: z.number().int().nonnegative(),
  firstNotifiedAtNs: z.bigint().nullable(),
  lifecycleState: LifecycleStateSchema,
  suppressionState: SuppressionStateSchema,
  resolutionSource: ResolutionSourceSchema.nullable(),
  alertname: z.string(),
  namespace: z.string().nullable(),
  severity: SeveritySchema,
  summary: z.string(),
  generatorUrl: z.url().nullable(),
  labels: LabelMapSchema,
  annotations: LabelMapSchema,
});

export const AlertEventRecordSchema = z.object({
  id: AlertEventIdSchema,
  occurrenceId: AlertOccurrenceIdSchema,
  type: z.enum([
    "opened",
    "resolved",
    "suppression_changed",
    "reconciliation_discrepancy",
  ]),
  occurredAtNs: z.bigint(),
  source: z.enum(["webhook", "snapshot", "reconciliation"]),
  detail: z.record(z.string(), z.unknown()).nullable(),
});

export type AlertOccurrenceRecord = z.infer<typeof AlertOccurrenceRecordSchema>;

function digest(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex").slice(0, 32);
}

export function occurrenceId(
  fingerprint: string,
  startedAtNs: bigint,
): z.infer<typeof AlertOccurrenceIdSchema> {
  return AlertOccurrenceIdSchema.parse(
    `alert_${digest(`alertmanager\0${fingerprint}\0${startedAtNs.toString()}`)}`,
  );
}

export function eventId(
  occurrence: string,
  type: string,
  occurredAtNs: bigint,
): z.infer<typeof AlertEventIdSchema> {
  return AlertEventIdSchema.parse(
    `event_${digest(`${occurrence}\0${type}\0${occurredAtNs.toString()}`)}`,
  );
}

export function severityFromLabels(
  labels: Readonly<Record<string, string>>,
): z.infer<typeof SeveritySchema> {
  const parsed = SeveritySchema.safeParse(labels["severity"]);
  return parsed.success ? parsed.data : "unknown";
}

export function suppressionFromSnapshot(
  alert: AlertmanagerSnapshotAlert,
): z.infer<typeof SuppressionStateSchema> {
  if (alert.status.silencedBy.length > 0) return "silenced";
  if (alert.status.inhibitedBy.length > 0) return "inhibited";
  return alert.status.state === "unprocessed" ? "unprocessed" : "none";
}

export function summaryFromMetadata(
  labels: Readonly<Record<string, string>>,
  annotations: Readonly<Record<string, string>>,
): string {
  return annotations["summary"] ?? labels["alertname"] ?? "Unnamed alert";
}

export function normalizeGeneratorUrl(
  value: string | undefined,
): string | null {
  if (value === undefined || value.length === 0) return null;
  AlertmanagerGeneratorUrlSchema.parse(value);
  return value.startsWith("/") ? null : z.url().parse(value);
}

export function openingEmail(
  alerts: readonly AlertOccurrenceRecord[],
  alertmanagerTruncatedAlerts = 0,
): {
  subject: string;
  htmlBody: string;
  plainBody: string;
} {
  const { subject, document } = buildAlertOpeningDocument({
    alerts: alerts.map((alert) => ({
      id: alert.id,
      alertname: alert.alertname,
      namespace: alert.namespace,
      severity: alert.severity,
      summary: alert.summary,
      openedAtIso: epochNanosecondsToInstantText(alert.openedAtNs),
      labels: alert.labels,
      annotations: alert.annotations,
    })),
    alertmanagerTruncatedAlerts,
    hubBaseUrl: APP_HOSTS.hub,
  });
  return {
    subject,
    htmlBody: renderEmailHtml(document),
    plainBody: renderEmailText(document),
  };
}

export function truncationEmail(truncatedAlerts: number): {
  subject: string;
  htmlBody: string;
  plainBody: string;
} {
  const { subject, document } = buildAlertTruncationDocument(
    truncatedAlerts,
    APP_HOSTS.hub,
  );
  return {
    subject,
    htmlBody: renderEmailHtml(document),
    plainBody: renderEmailText(document),
  };
}

export function snapshotStartNs(alert: AlertmanagerSnapshotAlert): bigint {
  return instantTextToEpochNanoseconds(alert.startsAt);
}

type LivenessFields = Pick<
  AlertOccurrenceRecord,
  "lifecycleState" | "missingSinceNs" | "lastSeenAtNs"
>;

/**
 * Reconciliation does not rewrite an unchanged open occurrence on every
 * snapshot. An open occurrence with no recorded absence was present in the
 * latest successful snapshot (or observed by a webhook after it), so it was
 * last seen at whichever is later: its stored observation or that snapshot.
 * Resolved and missing occurrences keep the stored instant, which the
 * reconciler materializes when it first records an absence.
 */
export function observedLastSeenAtNs(
  occurrence: LivenessFields,
  latestSnapshotCompletedAtNs: bigint | null,
): bigint {
  if (
    latestSnapshotCompletedAtNs === null ||
    occurrence.lifecycleState !== "open" ||
    occurrence.missingSinceNs !== null
  )
    return occurrence.lastSeenAtNs;
  return occurrence.lastSeenAtNs > latestSnapshotCompletedAtNs
    ? occurrence.lastSeenAtNs
    : latestSnapshotCompletedAtNs;
}

export function sameStringMap(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && left[key] === right[key],
    )
  );
}

export type LabelChanges = {
  removed: string[];
  upserted: [key: string, value: string][];
};

/** The minimal row changes that turn the `previous` label set into `next`. */
export function labelChanges(
  previous: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): LabelChanges {
  return {
    removed: Object.keys(previous).filter((key) => !Object.hasOwn(next, key)),
    upserted: Object.entries(next).filter(
      ([key, value]) => previous[key] !== value,
    ),
  };
}
