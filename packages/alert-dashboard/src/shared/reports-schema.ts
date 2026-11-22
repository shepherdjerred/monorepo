import { DigestKindSchema } from "@shepherdjerred/ops-model/digest.ts";
import { MailboxAddressSchema } from "@shepherdjerred/ops-model/email/mailbox.ts";
import {
  ReportEnvelopeV1Schema,
  ReportVerdictSchema,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import { ReportDeliveryStatusSchema } from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import { RecurringReportScheduleSchema } from "@shepherdjerred/ops-model/reports/schedule-catalog.ts";
import { z } from "zod";

import { DigestReportSchema } from "#shared/ops-schema";

const IsoTimestampSchema = z.iso.datetime({ offset: true });
const HttpUrlSchema = z.url({ protocol: /^https?$/u });

export const ScheduleFreshnessSchema = z.enum(["fresh", "stale", "empty"]);
export type ScheduleFreshness = z.infer<typeof ScheduleFreshnessSchema>;

export const ScheduleDayStateSchema = z.enum([
  "none",
  "clear",
  "quiet-clear",
  "changed",
  "attention",
  "failed",
]);
export type ScheduleDayState = z.infer<typeof ScheduleDayStateSchema>;

export const ScheduleDayCellSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  state: ScheduleDayStateSchema,
  runCount: z.number().int().nonnegative(),
  prUrl: HttpUrlSchema.optional(),
});
export type ScheduleDayCell = z.infer<typeof ScheduleDayCellSchema>;

export const ScheduleLatestRunSchema = z.object({
  id: z.string().min(1),
  runHref: z.string().min(1),
  completedAt: IsoTimestampSchema,
  subject: z.string().min(1),
  headline: z.string().min(1),
  verdict: ReportVerdictSchema,
  deliveryStatus: ReportDeliveryStatusSchema,
  skipReason: z.string().min(1).optional(),
  prUrl: HttpUrlSchema.optional(),
  autoMergeEnabled: z.boolean().optional(),
});
export type ScheduleLatestRun = z.infer<typeof ScheduleLatestRunSchema>;

export const ScheduleOverviewItemSchema = z.object({
  ...RecurringReportScheduleSchema.shape,
  freshness: ScheduleFreshnessSchema,
  latestRun: ScheduleLatestRunSchema.nullable(),
  days: z.array(ScheduleDayCellSchema).length(30),
});
export type ScheduleOverviewItem = z.infer<typeof ScheduleOverviewItemSchema>;

export const ReportsKpisSchema = z.object({
  needsReviewCount: z.number().int().nonnegative(),
  autoPrCount7d: z.number().int().nonnegative(),
  quietSkips7d: z.number().int().nonnegative(),
  freshSchedules: z.number().int().nonnegative(),
  totalSchedules: z.number().int().nonnegative(),
  pendingIncidentEmails: z.number().int().nonnegative(),
  failedIncidentEmails: z.number().int().nonnegative(),
});
export type ReportsKpis = z.infer<typeof ReportsKpisSchema>;

export const ReportsOverviewResponseSchema = z.object({
  kpis: ReportsKpisSchema,
  schedules: z.array(ScheduleOverviewItemSchema),
});
export type ReportsOverviewResponse = z.infer<
  typeof ReportsOverviewResponseSchema
>;

export const ReportsFeedTabSchema = z.enum([
  "all",
  "reports",
  "digests",
  "agent-tasks",
  "incidents",
]);
export type ReportsFeedTab = z.infer<typeof ReportsFeedTabSchema>;

export const ReportFeedKindSchema = z.enum([
  "temporal-report",
  "ops-digest",
  "agent-task",
  "incident-mail",
]);
export type ReportFeedKind = z.infer<typeof ReportFeedKindSchema>;

export const ReportFeedDeliveryStatusSchema = z.enum([
  "sent",
  "skipped",
  "pending",
  "failed",
  "canceled",
]);
export type ReportFeedDeliveryStatus = z.infer<
  typeof ReportFeedDeliveryStatusSchema
>;

export const ReportsFeedQuerySchema = z.object({
  tab: ReportsFeedTabSchema.default("all"),
  scheduleId: z.string().min(1).max(120).optional(),
  mailbox: z.string().min(1).max(160).optional(),
  verdict: ReportVerdictSchema.optional(),
  delivery: ReportFeedDeliveryStatusSchema.optional(),
  hasPr: z.literal("1").optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ReportsFeedQuery = z.infer<typeof ReportsFeedQuerySchema>;
export type ReportsFeedQueryInput = z.input<typeof ReportsFeedQuerySchema>;

export const ReportFeedItemSchema = z.object({
  kind: ReportFeedKindSchema,
  id: z.string().min(1),
  href: z.string().min(1),
  occurredAt: IsoTimestampSchema,
  scheduleId: z.string().min(1).nullable(),
  eyebrow: z.string().min(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  headline: z.string().min(1),
  mailboxFrom: MailboxAddressSchema,
  mailboxTo: z.email(),
  verdict: ReportVerdictSchema,
  deliveryStatus: ReportFeedDeliveryStatusSchema,
  skipReason: z.string().min(1).optional(),
  prUrl: HttpUrlSchema.optional(),
  autoMergeEnabled: z.boolean().optional(),
  findingCount: z.number().int().nonnegative(),
  actionableFindingCount: z.number().int().nonnegative(),
  failedCheckCount: z.number().int().nonnegative(),
});
export type ReportFeedItem = z.infer<typeof ReportFeedItemSchema>;

export const ReportsFeedResponseSchema = z.object({
  items: z.array(ReportFeedItemSchema),
});
export type ReportsFeedResponse = z.infer<typeof ReportsFeedResponseSchema>;

export const ReportRunSiblingSchema = ScheduleLatestRunSchema.extend({
  findingCount: z.number().int().nonnegative(),
  actionableFindingCount: z.number().int().nonnegative(),
  failedCheckCount: z.number().int().nonnegative(),
});
export type ReportRunSibling = z.infer<typeof ReportRunSiblingSchema>;

export const ReportRunDetailSchema = z.object({
  id: z.string().min(1),
  report: ReportEnvelopeV1Schema,
  subject: z.string().min(1),
  eyebrow: z.string().min(1),
  mailboxFrom: MailboxAddressSchema,
  mailboxTo: z.email(),
  deliveryStatus: ReportDeliveryStatusSchema,
  skipReason: z.string().min(1).optional(),
  messageId: z.string().min(1).nullable(),
  acceptedAt: IsoTimestampSchema.nullable(),
  receivedAt: IsoTimestampSchema,
  htmlBody: z.string().min(1),
  plainBody: z.string().min(1),
  recentRuns: z.array(ReportRunSiblingSchema).max(14),
});
export type ReportRunDetail = z.infer<typeof ReportRunDetailSchema>;

export const DigestRunDetailStatusSchema = z.enum([
  "sent",
  "skipped",
  "failed",
  "live-preview",
]);
export type DigestRunDetailStatus = z.infer<typeof DigestRunDetailStatusSchema>;

export const DigestRunDetailSchema = z.object({
  kind: DigestKindSchema,
  periodKey: z.string().min(1),
  status: DigestRunDetailStatusSchema,
  skipReason: z.string().min(1).optional(),
  createdAt: IsoTimestampSchema,
  sentAt: IsoTimestampSchema.nullable(),
  subject: z.string().min(1),
  mailboxFrom: MailboxAddressSchema,
  mailboxTo: z.email(),
  report: DigestReportSchema,
  htmlBody: z.string().min(1),
  plainBody: z.string().min(1),
});
export type DigestRunDetail = z.infer<typeof DigestRunDetailSchema>;

export const IncidentMailStatusSchema = z.enum([
  "sent",
  "pending",
  "failed",
  "canceled",
]);
export type IncidentMailStatus = z.infer<typeof IncidentMailStatusSchema>;

export const IncidentMailOccurrenceSchema = z.object({
  id: z.string().min(1),
  alertname: z.string().min(1),
  severity: z.string().min(1),
  summary: z.string(),
  lifecycleState: z.string().min(1),
  openedAt: IsoTimestampSchema,
});
export type IncidentMailOccurrence = z.infer<
  typeof IncidentMailOccurrenceSchema
>;

export const IncidentMailDetailSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
  subject: z.string().min(1),
  mailboxFrom: MailboxAddressSchema,
  mailboxTo: z.email(),
  status: IncidentMailStatusSchema,
  createdAt: IsoTimestampSchema,
  sentAt: IsoTimestampSchema.nullable(),
  canceledAt: IsoTimestampSchema.nullable(),
  canceledBy: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  htmlBody: z.string().min(1),
  plainBody: z.string().nullable(),
  occurrences: z.array(IncidentMailOccurrenceSchema),
});
export type IncidentMailDetail = z.infer<typeof IncidentMailDetailSchema>;

export const ReportRunIngestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
});
export type ReportRunIngestResponse = z.infer<
  typeof ReportRunIngestResponseSchema
>;
