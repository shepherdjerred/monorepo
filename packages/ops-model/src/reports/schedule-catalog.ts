import { z } from "zod";
import {
  MailboxAddressSchema,
  OPS_MAILBOXES,
  type MailboxPair,
} from "@shepherdjerred/ops-model/email/mailbox.ts";

export const RecurringStreamKindSchema = z.enum([
  "temporal-report",
  "ops-digest",
]);
export type RecurringStreamKind = z.infer<typeof RecurringStreamKindSchema>;

export const NotificationPolicySchema = z.enum(["cadence", "daily-changed"]);
export type NotificationPolicy = z.infer<typeof NotificationPolicySchema>;

export const AutomationModeSchema = z.enum([
  "llm-pr-automerge",
  "llm-pr-review",
  "deterministic-pr",
  "diagnostic",
  "digest",
]);
export type AutomationMode = z.infer<typeof AutomationModeSchema>;

export const RecurringReportScheduleSchema = z.strictObject({
  scheduleId: z.string().min(1),
  streamKind: RecurringStreamKindSchema,
  reportType: z.string().min(1),
  title: z.string().min(1),
  eyebrow: z.string().min(1),
  cronLabel: z.string().min(1),
  cadenceHours: z.number().positive(),
  graceHours: z.number().positive(),
  mailbox: z.strictObject({
    from: MailboxAddressSchema,
    to: z.email(),
  }),
  notificationPolicy: NotificationPolicySchema,
  automationMode: AutomationModeSchema,
});

export type RecurringReportSchedule = {
  readonly scheduleId: string;
  readonly streamKind: RecurringStreamKind;
  readonly reportType: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly cronLabel: string;
  readonly cadenceHours: number;
  readonly graceHours: number;
  readonly mailbox: MailboxPair;
  readonly notificationPolicy: NotificationPolicy;
  readonly automationMode: AutomationMode;
};

export const RECURRING_REPORT_SCHEDULES: readonly RecurringReportSchedule[] = [
  {
    scheduleId: "link-rot-scan-weekly",
    streamKind: "temporal-report",
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan",
    eyebrow: "Link Check",
    cronLabel: "Sun 09:00 PT",
    cadenceHours: 168,
    graceHours: 6,
    mailbox: OPS_MAILBOXES.reports.general,
    notificationPolicy: "cadence",
    automationMode: "llm-pr-automerge",
  },
  {
    scheduleId: "main-vuln-scan-weekly",
    streamKind: "temporal-report",
    reportType: "main-vuln-scan",
    title: "Weekly vulnerability scan",
    eyebrow: "Security Scan",
    cronLabel: "Sun 05:00 PT",
    cadenceHours: 168,
    graceHours: 6,
    mailbox: OPS_MAILBOXES.reports.general,
    notificationPolicy: "cadence",
    automationMode: "llm-pr-review",
  },
  {
    scheduleId: "the-storm-promotion-daily",
    streamKind: "temporal-report",
    reportType: "storm-promotion",
    title: "The Storm promotion summary",
    eyebrow: "The Storm Promotion",
    cronLabel: "Daily 08:00 PT",
    cadenceHours: 24,
    graceHours: 2,
    mailbox: OPS_MAILBOXES.reports.general,
    notificationPolicy: "daily-changed",
    automationMode: "diagnostic",
  },
  {
    scheduleId: "homelab-audit-daily",
    streamKind: "temporal-report",
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    eyebrow: "Homelab Check",
    cronLabel: "Daily 06:30 PT",
    cadenceHours: 24,
    graceHours: 2,
    mailbox: OPS_MAILBOXES.reports.ops,
    notificationPolicy: "daily-changed",
    automationMode: "diagnostic",
  },
  {
    scheduleId: "tasknotes-skipped-files-canary",
    streamKind: "temporal-report",
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    eyebrow: "TaskNotes Check",
    cronLabel: "Mon 09:00 PT",
    cadenceHours: 168,
    graceHours: 6,
    mailbox: OPS_MAILBOXES.reports.ops,
    notificationPolicy: "cadence",
    automationMode: "diagnostic",
  },
  {
    scheduleId: "deps-summary-weekly",
    streamKind: "temporal-report",
    reportType: "dependency-summary",
    title: "Weekly dependency summary",
    eyebrow: "Repo Dependencies",
    cronLabel: "Mon 09:00 PT",
    cadenceHours: 168,
    graceHours: 6,
    mailbox: OPS_MAILBOXES.reports.dependencies,
    notificationPolicy: "cadence",
    automationMode: "llm-pr-review",
  },
  {
    scheduleId: "scout-data-dragon-version-check",
    streamKind: "temporal-report",
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon patch check",
    eyebrow: "Scout Automation",
    cronLabel: "Sun–Fri 06:00 PT",
    cadenceHours: 48,
    graceHours: 2,
    mailbox: OPS_MAILBOXES.reports.scout,
    notificationPolicy: "daily-changed",
    automationMode: "deterministic-pr",
  },
  {
    scheduleId: "scout-data-dragon-weekly-refresh",
    streamKind: "temporal-report",
    reportType: "scout-data-dragon",
    title: "Scout Data Dragon weekly refresh",
    eyebrow: "Scout Automation",
    cronLabel: "Sat 06:00 PT",
    cadenceHours: 168,
    graceHours: 6,
    mailbox: OPS_MAILBOXES.reports.scout,
    notificationPolicy: "cadence",
    automationMode: "deterministic-pr",
  },
  {
    scheduleId: "scout-queue-windows-daily",
    streamKind: "temporal-report",
    reportType: "scout-queue-windows",
    title: "Scout queue windows watcher",
    eyebrow: "Scout Automation",
    cronLabel: "Daily 06:45 PT",
    cadenceHours: 24,
    graceHours: 2,
    mailbox: OPS_MAILBOXES.reports.scout,
    notificationPolicy: "daily-changed",
    automationMode: "llm-pr-review",
  },
  {
    scheduleId: "scout-lane-priors-weekly-refresh",
    streamKind: "temporal-report",
    reportType: "scout-lane-priors",
    title: "Scout lane priors refresh",
    eyebrow: "Scout Automation",
    cronLabel: "Sat 07:00 PT",
    cadenceHours: 168,
    graceHours: 6,
    mailbox: OPS_MAILBOXES.reports.scout,
    notificationPolicy: "cadence",
    automationMode: "deterministic-pr",
  },
  {
    scheduleId: "scout-season-refresh-weekly",
    streamKind: "temporal-report",
    reportType: "scout-season-refresh",
    title: "Scout season schedule refresh",
    eyebrow: "Scout Automation",
    cronLabel: "Mon 07:00 PT",
    cadenceHours: 168,
    graceHours: 6,
    mailbox: OPS_MAILBOXES.reports.scout,
    notificationPolicy: "cadence",
    automationMode: "llm-pr-review",
  },
  {
    scheduleId: "ops-digest-daily",
    streamKind: "ops-digest",
    reportType: "ops-digest-daily",
    title: "Daily operations digest",
    eyebrow: "Hub Digest",
    cronLabel: "Daily 07:30 PT",
    cadenceHours: 24,
    graceHours: 2,
    mailbox: OPS_MAILBOXES.digests,
    notificationPolicy: "daily-changed",
    automationMode: "digest",
  },
  {
    scheduleId: "ops-digest-weekly",
    streamKind: "ops-digest",
    reportType: "ops-digest-weekly",
    title: "Weekly operations review",
    eyebrow: "Hub Digest",
    cronLabel: "Mon 08:00 PT",
    cadenceHours: 168,
    graceHours: 6,
    mailbox: OPS_MAILBOXES.digests,
    notificationPolicy: "cadence",
    automationMode: "digest",
  },
];

export const TEMPORAL_REPORT_SCHEDULES: readonly RecurringReportSchedule[] =
  RECURRING_REPORT_SCHEDULES.filter(
    (schedule) => schedule.streamKind === "temporal-report",
  );

export const OPS_DIGEST_SCHEDULES: readonly RecurringReportSchedule[] =
  RECURRING_REPORT_SCHEDULES.filter(
    (schedule) => schedule.streamKind === "ops-digest",
  );

/**
 * Maps `scheduleId -> reportType` for Temporal scheduled report streams that
 * use the quiet-clear / changed-only notification policy.
 */
export const DAILY_CHANGED_TEMPORAL_FAMILIES: Readonly<Record<string, string>> =
  Object.fromEntries(
    TEMPORAL_REPORT_SCHEDULES.filter(
      (schedule) => schedule.notificationPolicy === "daily-changed",
    ).map((schedule) => [schedule.scheduleId, schedule.reportType]),
  );

const SCHEDULES_BY_ID = new Map(
  RECURRING_REPORT_SCHEDULES.map((schedule) => [schedule.scheduleId, schedule]),
);

export function findRecurringSchedule(
  scheduleId: string,
): RecurringReportSchedule | undefined {
  return SCHEDULES_BY_ID.get(scheduleId);
}

export function usesDailyChangedTemporalPolicy(input: {
  scheduleId?: string | undefined;
  reportType: string;
}): boolean {
  return (
    input.scheduleId !== undefined &&
    DAILY_CHANGED_TEMPORAL_FAMILIES[input.scheduleId] === input.reportType
  );
}
