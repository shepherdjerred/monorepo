import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "#shared/reports/report.ts";
import { REPORT_SEND_CLAIM_TAKEOVER_MS } from "#shared/reports/report-delivery-policy.ts";

const DAILY_NOTIFICATION_FAMILIES: Readonly<Record<string, string>> = {
  "homelab-audit-daily": "homelab-audit",
  "ci-io-telemetry-daily": "ci-io-telemetry",
  "scout-queue-windows-daily": "scout-queue-windows",
  "daily-notification-policy-canary": "daily-notification-policy-canary",
};
const REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

export function usesDailyNotificationPolicy(
  report: Pick<ReportEnvelopeV1, "scheduleId" | "reportType">,
): boolean {
  return (
    report.scheduleId !== undefined &&
    DAILY_NOTIFICATION_FAMILIES[report.scheduleId] === report.reportType
  );
}

const AcceptedNotificationSchema = z.object({
  reportRunId: z.string().min(1),
  completedAt: z.iso.datetime({ offset: true }),
  acceptedAt: z.iso.datetime({ offset: true }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const NotificationFamilySchema = z.object({
  schemaVersion: z.literal(1),
  lastAccepted: AcceptedNotificationSchema.optional(),
  lastObserved: z
    .object({
      reportRunId: z.string().min(1),
      completedAt: z.iso.datetime({ offset: true }),
    })
    .optional(),
  pending: z
    .object({
      reportRunId: z.string().min(1),
      observationKey: z.string().min(1),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      owner: z.string().min(1),
      claimedAt: z.iso.datetime({ offset: true }),
      skipReason: z.enum(["unchanged", "superseded"]).optional(),
    })
    .optional(),
});
export type NotificationFamily = z.infer<typeof NotificationFamilySchema>;

export const SkippedNotificationSchema = z.object({
  outcome: z.literal("skipped"),
  reason: z.enum(["unchanged", "superseded"]),
  reportRunId: z.string().min(1),
  reportType: z.string().min(1),
  scheduleId: z.string().min(1),
  completedAt: z.iso.datetime({ offset: true }),
  observationKey: z.string().min(1),
});
export type SkippedNotification = z.infer<typeof SkippedNotificationSchema>;

export const NotificationModeSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["cadence", "changed"]),
});
export type NotificationMode = z.infer<typeof NotificationModeSchema>;

/** Freeze admission per run, including the off state, across flag changes. */
export async function selectNotificationMode(deps: {
  read: () => Promise<NotificationMode | undefined>;
  write: (value: NotificationMode) => Promise<boolean>;
  legacyDeliveryStarted: () => Promise<boolean>;
  enabled: () => Promise<boolean>;
}): Promise<NotificationMode["mode"]> {
  const existing = await deps.read();
  if (existing !== undefined) return existing.mode;
  const legacy = await deps.legacyDeliveryStarted();
  const mode = !legacy && (await deps.enabled()) ? "changed" : "cadence";
  await deps.write({ schemaVersion: 1, mode });
  const recorded = NotificationModeSchema.parse(await deps.read());
  return recorded.mode;
}

/** The archive is immutable; a retry uses its original observation time. */
export type NotificationBackend = {
  readObservation: (key: string) => Promise<ReportEnvelopeV1 | undefined>;
  writeObservation: (key: string, report: ReportEnvelopeV1) => Promise<boolean>;
  readSkip: (key: string) => Promise<SkippedNotification | undefined>;
  writeSkip: (key: string, result: SkippedNotification) => Promise<boolean>;
  readFamily: (
    key: string,
  ) => Promise<{ value: NotificationFamily; etag: string } | undefined>;
  writeFamily: (
    key: string,
    value: NotificationFamily,
    expectedEtag: string | undefined,
  ) => Promise<boolean>;
};

function safePart(value: string): string {
  return value.replaceAll(/[^\w.=-]+/g, "-");
}

export function notificationFamilyPath(
  report: Pick<ReportEnvelopeV1, "reportType" | "scheduleId">,
): string {
  if (!usesDailyNotificationPolicy(report) || report.scheduleId === undefined) {
    throw new Error("Report is outside the daily notification policy");
  }
  return `${safePart(report.reportType)}/${safePart(report.scheduleId)}`;
}

export function skippedNotificationPrefix(
  report: Pick<ReportEnvelopeV1, "reportType" | "scheduleId">,
  namespace = "prod",
): string {
  return `reports/notifications/skipped/${safePart(namespace)}/${notificationFamilyPath(report)}/`;
}

export function notificationCondition(report: ReportEnvelopeV1): {
  fingerprint: string;
  actionable: boolean;
} {
  const findings = report.findings.filter(
    (finding) =>
      finding.severity !== "info" &&
      (finding.state === undefined || finding.state === "active"),
  );
  const canonical = {
    execution: report.execution,
    verdict: report.verdict,
    checks: report.checks
      .map((check) => ({
        id: check.id,
        status: check.status,
        required: check.required,
        // Collector failures have no stable finding identity. Preserve their
        // error text so a different failure cannot be hidden by the same ID.
        ...(report.execution === "complete" ? {} : { summary: check.summary }),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    findings: findings
      .map((finding) =>
        JSON.stringify({
          id: finding.id,
          severity: finding.severity,
          ...(finding.id === undefined
            ? { summary: finding.summary, detail: finding.detail }
            : {}),
        }),
      )
      .sort(),
    limitations: [...report.limitations].sort(),
  };
  return {
    fingerprint: createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex"),
    actionable:
      report.execution !== "complete" ||
      ["attention", "pending", "inconclusive"].includes(report.verdict) ||
      findings.length > 0 ||
      report.checks.some(
        (check) => check.required && check.status !== "passed",
      ),
  };
}

function notificationReason(
  report: ReportEnvelopeV1,
  family: NotificationFamily,
  now: string,
): "send" | SkippedNotification["reason"] {
  const previous = family.lastAccepted;
  const observed = family.lastObserved ?? previous;
  if (
    observed !== undefined &&
    Date.parse(report.completedAt) < Date.parse(observed.completedAt)
  ) {
    return "superseded";
  }
  if (previous === undefined) return "send";
  if (Date.parse(report.completedAt) < Date.parse(previous.completedAt)) {
    return "superseded";
  }
  const condition = notificationCondition(report);
  if (condition.fingerprint !== previous.fingerprint) return "send";
  return condition.actionable &&
    Date.parse(now) - Date.parse(previous.acceptedAt) >= REMINDER_MS
    ? "send"
    : "unchanged";
}

type AcceptedDelivery = { reportRunId: string; acceptedAt: string };

function notificationSkipKey(
  report: ReportEnvelopeV1,
  namespace: string,
): string {
  return `${skippedNotificationPrefix(report, namespace)}${new Date(report.completedAt).toISOString()}-${safePart(report.reportRunId)}.json`;
}

function latestObservation(
  family: NotificationFamily,
  report: ReportEnvelopeV1,
): NonNullable<NotificationFamily["lastObserved"]> {
  const previous = family.lastObserved ?? family.lastAccepted;
  const newest =
    previous !== undefined &&
    Date.parse(previous.completedAt) > Date.parse(report.completedAt)
      ? previous
      : report;
  return { reportRunId: newest.reportRunId, completedAt: newest.completedAt };
}

type NotificationDependencies<T extends AcceptedDelivery> = {
  backend: NotificationBackend;
  namespace: string;
  owner: string;
  attemptStartedAt: string;
  now: () => string;
  accepted: (report: ReportEnvelopeV1) => Promise<T | undefined>;
  deliver: (report: ReportEnvelopeV1) => Promise<T>;
};

async function archiveNotification(
  input: ReportEnvelopeV1,
  deps: Pick<
    NotificationDependencies<AcceptedDelivery>,
    "backend" | "namespace"
  >,
): Promise<{
  report: ReportEnvelopeV1;
  familyPath: string;
  observationKey: string;
}> {
  ReportEnvelopeV1Schema.parse(input);
  const familyPath = `${safePart(deps.namespace)}/${notificationFamilyPath(input)}`;
  const observationKey = `reports/observations/${familyPath}/${safePart(input.reportRunId)}.json`;
  await deps.backend.writeObservation(observationKey, input);
  const report = ReportEnvelopeV1Schema.parse(
    await deps.backend.readObservation(observationKey),
  );
  if (
    report.reportRunId !== input.reportRunId ||
    notificationFamilyPath(report) !== notificationFamilyPath(input)
  ) {
    throw new Error("Archived notification references a different report");
  }
  return { report, familyPath, observationKey };
}

/**
 * Serialize every family decision with CAS. A takeover first settles the recorded
 * pending report through the existing per-run delivery lease/receipt path.
 * This repairs a crash after Postal acceptance without advancing the family
 * optimistically or treating an ambiguous send as an unchanged report.
 */
export async function deliverDailyNotification<T extends AcceptedDelivery>(
  input: ReportEnvelopeV1,
  deps: NotificationDependencies<T>,
): Promise<T | SkippedNotification> {
  const { report, familyPath, observationKey } = await archiveNotification(
    input,
    deps,
  );
  const accepted = await deps.accepted(report);
  if (accepted !== undefined) return accepted;
  // Timestamped keys preserve observation order when an old retry writes its
  // skip later than a newer run. LastModified is not report freshness.
  const skipKey = notificationSkipKey(report, deps.namespace);
  const skipped = await deps.backend.readSkip(skipKey);
  if (skipped !== undefined) return skipped;
  const familyKey = `reports/notifications/families/${familyPath}.json`;
  for (;;) {
    const held = await deps.backend.readFamily(familyKey);
    const family = held?.value ?? { schemaVersion: 1 as const };
    if (family.pending !== undefined) {
      const delivery = await settlePendingNotification({
        deps,
        familyKey,
        held,
        family,
      });
      if (delivery?.reportRunId === report.reportRunId) return delivery;
      continue;
    }
    const reason = notificationReason(report, family, deps.now());
    const reserved = await deps.backend.writeFamily(
      familyKey,
      {
        ...family,
        pending: {
          reportRunId: report.reportRunId,
          observationKey,
          fingerprint: notificationCondition(report).fingerprint,
          owner: deps.owner,
          claimedAt: deps.attemptStartedAt,
          ...(reason === "send" ? {} : { skipReason: reason }),
        },
      },
      held?.etag,
    );
    if (!reserved)
      throw new Error("Daily report notification family is contended");
  }
}

async function settlePendingNotification<T extends AcceptedDelivery>(input: {
  deps: NotificationDependencies<T>;
  familyKey: string;
  held: { value: NotificationFamily; etag: string } | undefined;
  family: NotificationFamily;
}): Promise<T | SkippedNotification | undefined> {
  const { deps, familyKey, held, family } = input;
  const pending = family.pending;
  if (pending === undefined || held === undefined) {
    throw new Error("Notification pending state has no stored claim");
  }
  if (pending.owner !== deps.owner) {
    const age =
      Date.parse(deps.attemptStartedAt) - Date.parse(pending.claimedAt);
    if (age < REPORT_SEND_CLAIM_TAKEOVER_MS) {
      throw new Error("Daily report notification is owned by another attempt");
    }
    const taken = await deps.backend.writeFamily(
      familyKey,
      {
        ...family,
        pending: {
          ...pending,
          owner: deps.owner,
          claimedAt: deps.attemptStartedAt,
        },
      },
      held.etag,
    );
    if (!taken)
      throw new Error("Daily report notification takeover is contended");
    // Re-read the new ETag before any send; only that claim may settle it.
    return;
  }
  const report = ReportEnvelopeV1Schema.parse(
    await deps.backend.readObservation(pending.observationKey),
  );
  if (
    report.reportRunId !== pending.reportRunId ||
    notificationCondition(report).fingerprint !== pending.fingerprint
  ) {
    throw new Error("Notification pending claim references a different report");
  }
  // Skip decisions hold the same claim as sends. Their observed family ETag
  // cannot be bypassed while a concurrent changed report advances acceptance.
  const delivery =
    pending.skipReason === undefined
      ? await deps.deliver(report)
      : await deps.accepted(report);
  const result =
    delivery ?? (await recordSkippedNotification(report, pending, deps));
  const recorded = await deps.backend.writeFamily(
    familyKey,
    {
      schemaVersion: 1,
      lastObserved: latestObservation(family, report),
      lastAccepted:
        delivery === undefined
          ? family.lastAccepted
          : {
              reportRunId: report.reportRunId,
              completedAt: report.completedAt,
              acceptedAt: delivery.acceptedAt,
              fingerprint: pending.fingerprint,
            },
    },
    held.etag,
  );
  if (!recorded)
    throw new Error("Daily report notification lost its family claim");
  return result;
}

async function recordSkippedNotification(
  report: ReportEnvelopeV1,
  pending: NonNullable<NotificationFamily["pending"]>,
  deps: Pick<
    NotificationDependencies<AcceptedDelivery>,
    "backend" | "namespace"
  >,
): Promise<SkippedNotification> {
  if (pending.skipReason === undefined)
    throw new Error("Notification skip has no reserved reason");
  const key = notificationSkipKey(report, deps.namespace);
  await deps.backend.writeSkip(
    key,
    SkippedNotificationSchema.parse({
      outcome: "skipped",
      reason: pending.skipReason,
      reportRunId: report.reportRunId,
      reportType: report.reportType,
      scheduleId: report.scheduleId,
      completedAt: report.completedAt,
      observationKey: pending.observationKey,
    }),
  );
  return SkippedNotificationSchema.parse(await deps.backend.readSkip(key));
}
