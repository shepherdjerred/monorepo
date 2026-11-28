/**
 * Alertmanager webhook payload (version 4), copied from Alertmanager's
 * documented `webhook_config` body rather than imported from Hub so this
 * package never depends on alert-dashboard.
 */
import { z } from "zod";

const LabelMapSchema = z.record(z.string(), z.string());

export const AlertmanagerWebhookAlertSchema = z.object({
  status: z.enum(["firing", "resolved"]),
  labels: LabelMapSchema,
  annotations: LabelMapSchema,
  startsAt: z.iso.datetime({ offset: true }),
  /** `0001-01-01T00:00:00Z` while firing without a known end. */
  endsAt: z.iso.datetime({ offset: true }),
  generatorURL: z.string(),
  fingerprint: z.string().min(1),
});
export type AlertmanagerWebhookAlert = z.infer<
  typeof AlertmanagerWebhookAlertSchema
>;

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
export type AlertmanagerWebhook = z.infer<typeof AlertmanagerWebhookSchema>;
