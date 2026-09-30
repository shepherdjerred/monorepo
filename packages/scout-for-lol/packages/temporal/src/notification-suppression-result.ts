import { z } from "zod";
import { NotificationUnsentSuppressionReasonSchema } from "@scout-for-lol/domain/notifications/intent.ts";

/** Definite non-send decided by a final policy or installation read. */
export const ScoutSuppressedNotificationDeliveryV2Schema = z.strictObject({
  outcome: z.literal("suppressed"),
  reason: NotificationUnsentSuppressionReasonSchema,
});
