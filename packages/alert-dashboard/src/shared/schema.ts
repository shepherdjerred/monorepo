import { z } from "zod";

import { InstantTextSchema } from "#shared/time";

export const AlertOccurrenceIdSchema = z
  .string()
  .regex(/^alert_[0-9a-f]{32}$/u)
  .brand<"AlertOccurrenceId">();
export const AlertEventIdSchema = z
  .string()
  .regex(/^event_[0-9a-f]{32}$/u)
  .brand<"AlertEventId">();
export const DeliveryIdSchema = z.uuid().brand<"DeliveryId">();
export const SnapshotRunIdSchema = z.uuid().brand<"SnapshotRunId">();
export const OutboxIdSchema = z.uuid().brand<"OutboxId">();
export const AlertFingerprintSchema = z
  .string()
  .min(1)
  .brand<"AlertFingerprint">();
export const LabelMapSchema = z.record(z.string(), z.string());
export const JsonObjectSchema = z.record(z.string(), z.json());
export type JsonObject = z.infer<typeof JsonObjectSchema>;
export const LifecycleStateSchema = z.enum(["open", "resolved"]);
export const SuppressionStateSchema = z.enum([
  "none",
  "silenced",
  "inhibited",
  "unprocessed",
]);
export const SeveritySchema = z.enum([
  "critical",
  "warning",
  "info",
  "unknown",
]);
export const ResolutionSourceSchema = z.enum(["webhook", "reconciled"]);
export const AlertEventTypeSchema = z.enum([
  "opened",
  "resolved",
  "suppression_changed",
  "reconciliation_discrepancy",
]);

export const AlertmanagerWebhookAlertSchema = z.object({
  status: z.enum(["firing", "resolved"]),
  labels: LabelMapSchema,
  annotations: LabelMapSchema,
  startsAt: InstantTextSchema,
  endsAt: InstantTextSchema,
  generatorURL: z.url().or(z.literal("")),
  fingerprint: AlertFingerprintSchema,
});

export const AlertmanagerWebhookSchema = z.object({
  version: z.literal("4"),
  groupKey: z.string(),
  truncatedAlerts: z.number().int().nonnegative(),
  status: z.enum(["firing", "resolved"]),
  receiver: z.string(),
  groupLabels: LabelMapSchema,
  commonLabels: LabelMapSchema,
  commonAnnotations: LabelMapSchema,
  externalURL: z.url(),
  notification_reason: z.string().optional(),
  alerts: z.array(AlertmanagerWebhookAlertSchema),
});

export const AlertmanagerSnapshotAlertSchema = z.object({
  annotations: LabelMapSchema,
  endsAt: InstantTextSchema,
  fingerprint: AlertFingerprintSchema,
  startsAt: InstantTextSchema,
  updatedAt: InstantTextSchema.optional(),
  generatorURL: z.url().or(z.literal("")).optional(),
  labels: LabelMapSchema,
  status: z.object({
    inhibitedBy: z.array(z.string()),
    silencedBy: z.array(z.string()),
    state: z.enum(["active", "suppressed", "unprocessed"]),
  }),
});

export const AlertViewSchema = z.object({
  id: AlertOccurrenceIdSchema,
  fingerprint: AlertFingerprintSchema,
  alertname: z.string(),
  namespace: z.string().nullable(),
  severity: SeveritySchema,
  summary: z.string(),
  lifecycleState: LifecycleStateSchema,
  suppressionState: SuppressionStateSchema,
  resolutionSource: ResolutionSourceSchema.nullable(),
  openedAt: InstantTextSchema,
  resolvedAt: InstantTextSchema.nullable(),
  lastSeenAt: InstantTextSchema,
  generatorUrl: z.url().nullable(),
  labels: LabelMapSchema,
  annotations: LabelMapSchema,
});

export const AlertEventViewSchema = z.object({
  id: AlertEventIdSchema,
  occurrenceId: AlertOccurrenceIdSchema,
  type: AlertEventTypeSchema,
  occurredAt: InstantTextSchema,
  source: z.enum(["webhook", "snapshot", "reconciliation"]),
  detail: z.record(z.string(), z.unknown()).nullable(),
});

export const WebhookDeliveryViewSchema = z.object({
  id: DeliveryIdSchema,
  receivedAt: InstantTextSchema,
  groupKey: z.string(),
  status: z.enum(["firing", "resolved"]),
  receiver: z.string(),
  notificationReason: z.string().nullable(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
  rawPayloadRetained: z.boolean(),
  rawExpiresAt: InstantTextSchema,
});

export const AlertDetailInputSchema = z.object({
  id: AlertOccurrenceIdSchema,
  cursor: DeliveryIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const AlertDetailSchema = AlertViewSchema.extend({
  events: z.array(AlertEventViewSchema),
  deliveries: z.array(WebhookDeliveryViewSchema),
  deliveriesNextCursor: DeliveryIdSchema.nullable(),
});

export const AlertListInputSchema = z.object({
  cursor: AlertOccurrenceIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  lifecycleState: LifecycleStateSchema.optional(),
  suppressionState: SuppressionStateSchema.optional(),
  severity: SeveritySchema.optional(),
  alertname: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  search: z.string().max(200).optional(),
  label: z.record(z.string(), z.string()).optional(),
  openedFrom: InstantTextSchema.optional(),
  openedTo: InstantTextSchema.optional(),
  resolvedFrom: InstantTextSchema.optional(),
  resolvedTo: InstantTextSchema.optional(),
});

export const EventListInputSchema = z.object({
  cursor: AlertEventIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  type: AlertEventTypeSchema.optional(),
  from: InstantTextSchema.optional(),
  to: InstantTextSchema.optional(),
  severity: SeveritySchema.optional(),
  alertname: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
});

export const AlertListResponseSchema = z.object({
  items: z.array(AlertViewSchema),
  nextCursor: AlertOccurrenceIdSchema.nullable(),
});
export const EventListResponseSchema = z.object({
  items: z.array(AlertEventViewSchema.extend({ alert: AlertViewSchema })),
  nextCursor: AlertEventIdSchema.nullable(),
});

export const SummarySchema = z.object({
  open: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
  silenced: z.number().int().nonnegative(),
  inhibited: z.number().int().nonnegative(),
  unprocessed: z.number().int().nonnegative(),
  lastReconciledAt: InstantTextSchema.nullable(),
});

export const SystemStatusSchema = z.object({
  database: z.enum(["ok", "error"]),
  alertmanager: z.enum(["ok", "stale", "error", "pending"]),
  grafana: z.enum(["ok", "error", "pending"]),
  postal: z.enum(["ok", "error", "disabled", "pending"]),
  emailEnabled: z.boolean(),
  pendingEmails: z.number().int().nonnegative(),
  failedEmails: z.number().int().nonnegative(),
  oldestPendingEmailAt: InstantTextSchema.nullable(),
  lastReconciledAt: InstantTextSchema.nullable(),
});

export const PreviewInputSchema = z.object({
  id: AlertOccurrenceIdSchema,
  from: InstantTextSchema,
  to: InstantTextSchema,
});
const PreviewResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    query: z.string(),
    data: z.json(),
  }),
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
  z.object({ status: z.literal("error"), reason: z.string() }),
]);
export const PreviewsSchema = z.object({
  prometheus: PreviewResultSchema,
  loki: PreviewResultSchema,
  tempo: PreviewResultSchema,
});

export type AlertmanagerWebhook = z.infer<typeof AlertmanagerWebhookSchema>;
export type AlertmanagerSnapshotAlert = z.infer<
  typeof AlertmanagerSnapshotAlertSchema
>;
export type AlertView = z.infer<typeof AlertViewSchema>;
export type AlertDetail = z.infer<typeof AlertDetailSchema>;
export type AlertDetailInput = z.infer<typeof AlertDetailInputSchema>;
export type AlertEventView = z.infer<typeof AlertEventViewSchema>;
export type AlertListInput = z.infer<typeof AlertListInputSchema>;
export type EventListInput = z.infer<typeof EventListInputSchema>;
export type AlertListResponse = z.infer<typeof AlertListResponseSchema>;
export type EventListResponse = z.infer<typeof EventListResponseSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type SystemStatus = z.infer<typeof SystemStatusSchema>;
export type PreviewInput = z.infer<typeof PreviewInputSchema>;
export type Previews = z.infer<typeof PreviewsSchema>;
