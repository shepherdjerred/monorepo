import { z } from "zod";
import { NotificationPolicySuppressionReasonSchema } from "@scout-for-lol/domain/notifications/intent.ts";

/** Definite non-send decided by a policy read inside the delivery Activity. */
export const ScoutSuppressedNotificationDeliveryV2Schema = z.strictObject({
  outcome: z.literal("suppressed"),
  reason: NotificationPolicySuppressionReasonSchema,
});
