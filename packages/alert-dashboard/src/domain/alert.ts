import sanitizeHtml from "sanitize-html";
import { z } from "zod";

import {
  AlertEventIdSchema,
  AlertFingerprintSchema,
  AlertOccurrenceIdSchema,
  LabelMapSchema,
  LifecycleStateSchema,
  ResolutionSourceSchema,
  SeveritySchema,
  SuppressionStateSchema,
  type AlertmanagerSnapshotAlert,
} from "#shared/schema";
import { instantTextToEpochNanoseconds } from "#shared/time";

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
export type AlertEventRecord = z.infer<typeof AlertEventRecordSchema>;

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
  if (alert.status.state === "unprocessed") return "unprocessed";
  return "none";
}

export function summaryFromMetadata(
  labels: Readonly<Record<string, string>>,
  annotations: Readonly<Record<string, string>>,
): string {
  return annotations["summary"] ?? labels["alertname"] ?? "Unnamed alert";
}

export function normalizeGeneratorUrl(value: string): string | null {
  return value.length === 0 ? null : z.url().parse(value);
}

export function openingEmail(alerts: readonly AlertOccurrenceRecord[]): {
  subject: string;
  htmlBody: string;
} {
  const critical = alerts.filter(
    (alert) => alert.severity === "critical",
  ).length;
  const prefix = critical > 0 ? "critical" : "warning";
  const subject = `[Alerts] ${alerts.length.toString()} ${prefix} alert${alerts.length === 1 ? "" : "s"} opened`;
  const rows = alerts
    .map((alert) => {
      const namespace =
        alert.namespace === null
          ? ""
          : ` <code>${escapeHtml(alert.namespace)}</code>`;
      return `<li><strong>${escapeHtml(alert.summary)}</strong>${namespace}<br><code>${escapeHtml(alert.alertname)}</code></li>`;
    })
    .join("");
  return {
    subject,
    htmlBody: `<h1>Alerts opened</h1><ul>${rows}</ul><p><a href="https://alerts.tailnet-1a49.ts.net/">Open Alerts</a></p>`,
  };
}

function escapeHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedAttributes: {},
    allowedTags: [],
    disallowedTagsMode: "escape",
  });
}

export function snapshotStartNs(alert: AlertmanagerSnapshotAlert): bigint {
  return instantTextToEpochNanoseconds(alert.startsAt);
}
