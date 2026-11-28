import { z } from "zod";

export const MESSAGE_PROTOCOLS = ["http", "smtp"] as const;
export const MessageProtocolSchema = z.enum(MESSAGE_PROTOCOLS);
export type MessageProtocol = z.infer<typeof MessageProtocolSchema>;

export const MESSAGE_STATUSES = [
  "queued",
  "sending",
  "retrying",
  "sent",
  "failed",
] as const;
export const MessageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const ATTEMPT_OUTCOMES = [
  "sent",
  "transient_error",
  "permanent_error",
] as const;
export const AttemptOutcomeSchema = z.enum(ATTEMPT_OUTCOMES);
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;

export const SendMessageRequestSchema = z
  .object({
    to: z.array(z.string().min(1)).min(1).max(50),
    from: z.string().min(1),
    subject: z.string().min(1).max(998),
    htmlBody: z
      .string()
      .max(10 * 1024 * 1024)
      .optional(),
    plainBody: z
      .string()
      .max(10 * 1024 * 1024)
      .optional(),
    headers: z.record(z.string(), z.string()).optional(),
    messageId: z.string().min(1).max(512).optional(),
    tag: z.string().min(1).max(256).optional(),
    idempotencyKey: z.string().min(1).max(512).optional(),
  })
  .refine(
    (value) =>
      (value.htmlBody !== undefined && value.htmlBody.length > 0) ||
      (value.plainBody !== undefined && value.plainBody.length > 0),
    { message: "Either htmlBody or plainBody is required" },
  );
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const SendMessageResponseSchema = z.object({
  id: z.string().min(1),
  rfcMessageId: z.string().min(1),
  status: MessageStatusSchema,
  deduplicated: z.boolean(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

export const MessageReceiptResponseSchema = z.object({
  id: z.string().min(1),
  rfcMessageId: z.string().min(1),
  status: MessageStatusSchema,
  recipients: z.array(z.string()),
  tag: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  lastSmtpCode: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type MessageReceiptResponse = z.infer<
  typeof MessageReceiptResponseSchema
>;

export const DeliveryAttemptSchema = z.object({
  id: z.number().int(),
  attemptNumber: z.number().int().positive(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  outcome: AttemptOutcomeSchema,
  smtpCode: z.number().int().nullable(),
  smtpResponse: z.string().nullable(),
  error: z.string().nullable(),
});
export type DeliveryAttempt = z.infer<typeof DeliveryAttemptSchema>;

export const AdminMessageSummarySchema = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  protocol: MessageProtocolSchema,
  rfcMessageId: z.string().min(1),
  mailFrom: z.string().min(1),
  recipients: z.array(z.string()),
  fromHeader: z.string(),
  toHeader: z.string(),
  subject: z.string(),
  tag: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  status: MessageStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  lastSmtpCode: z.number().int().nullable(),
  lastSmtpResponse: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type AdminMessageSummary = z.infer<typeof AdminMessageSummarySchema>;

export const AdminMessageDetailSchema = AdminMessageSummarySchema.extend({
  idempotencyKey: z.string().nullable(),
  plainBody: z.string().nullable(),
  htmlBody: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
  attempts: z.array(DeliveryAttemptSchema),
});
export type AdminMessageDetail = z.infer<typeof AdminMessageDetailSchema>;

export const AdminClientStatsSchema = z.object({
  clientId: z.string().min(1),
  sent24h: z.number().int().nonnegative(),
  failed24h: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
});
export type AdminClientStats = z.infer<typeof AdminClientStatsSchema>;

export const AdminOverviewResponseSchema = z.object({
  counts: z.object({
    all: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    sending: z.number().int().nonnegative(),
    retrying: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    sent: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    sent24h: z.number().int().nonnegative(),
    failed24h: z.number().int().nonnegative(),
  }),
  relay: z.object({
    enabled: z.boolean(),
    upstreamHost: z.string(),
    upstreamPort: z.number().int(),
    smtpListenerPort: z.number().int().nullable(),
    smtpTlsCertExpiresAt: z.string().nullable(),
    retentionDays: z.number().int().positive(),
  }),
  clients: z.array(AdminClientStatsSchema),
});
export type AdminOverviewResponse = z.infer<typeof AdminOverviewResponseSchema>;

export const AdminMessagesResponseSchema = z.object({
  items: z.array(AdminMessageSummarySchema),
  total: z.number().int().nonnegative(),
});
export type AdminMessagesResponse = z.infer<typeof AdminMessagesResponseSchema>;

export const AdminRetryResponseSchema = z.object({
  message: AdminMessageDetailSchema,
});
export type AdminRetryResponse = z.infer<typeof AdminRetryResponseSchema>;

export const KNOWN_MAIL_CLIENTS: Readonly<Record<string, string>> = {
  "alert-dashboard": "Hub",
  errors: "Errors",
  media: "Media",
  temporal: "Temporal",
  alertmanager: "Alertmanager",
  "storm-forum-prod": "Storm Forum",
  "storm-forum-beta": "Storm Forum (Beta)",
  seerr: "Seerr",
};

export function formatMailClientLabel(clientId: string): string {
  return KNOWN_MAIL_CLIENTS[clientId] ?? clientId;
}
