import { z } from "zod";
import { MailboxAddressSchema } from "@shepherdjerred/ops-model/email/mailbox.ts";
import { ReportEnvelopeV1Schema } from "./report-envelope.ts";

export const ReportDeliveryStatusSchema = z.enum([
  "sent",
  "skipped",
  "pending",
  "failed",
]);
export type ReportDeliveryStatus = z.infer<typeof ReportDeliveryStatusSchema>;

export const ReportSkipReasonSchema = z.enum(["unchanged", "superseded"]);
export type ReportSkipReason = z.infer<typeof ReportSkipReasonSchema>;

export const ReportRunIngestItemSchema = z.object({
  report: ReportEnvelopeV1Schema,
  subject: z.string().min(1),
  eyebrow: z.string().min(1),
  mailboxFrom: MailboxAddressSchema,
  mailboxTo: z.email(),
  deliveryStatus: ReportDeliveryStatusSchema,
  skipReason: ReportSkipReasonSchema.optional(),
  messageId: z.string().min(1).optional(),
  acceptedAt: z.iso.datetime({ offset: true }).optional(),
  htmlBody: z.string().min(1).optional(),
});
export type ReportRunIngestItem = z.infer<typeof ReportRunIngestItemSchema>;
export type ReportRunIngestItemInput = z.input<
  typeof ReportRunIngestItemSchema
>;

export const ReportRunIngestBatchSchema = z.object({
  items: z.array(ReportRunIngestItemSchema).min(1).max(50),
});
export type ReportRunIngestBatch = z.infer<typeof ReportRunIngestBatchSchema>;
export type ReportRunIngestBatchInput = z.input<
  typeof ReportRunIngestBatchSchema
>;
