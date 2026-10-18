import { z } from "zod";
/** Existing operator releases use 12 hex characters; Delivery hashes its request to 32. */
export const ForumReleaseIdSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{12}|[a-f0-9]{32})$/u);
export const ForumStepAcknowledgementSchema = z.strictObject({
  step: z.enum(["install", "addons", "seed", "history", "accounts"]),
  journalSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type ForumStepAcknowledgement = z.infer<
  typeof ForumStepAcknowledgementSchema
>;
export function parseForumRecoveryAction(raw: string): {
  action: "inspect" | "repair";
  acknowledgement?: ForumStepAcknowledgement;
} {
  if (raw === "inspect" || raw === "repair") return { action: raw };
  const [action, step, journalSha256, ...extra] = raw.split(":");
  if (action !== "repair" || extra.length > 0)
    throw new Error("Unknown fixed Forum recovery action");
  return {
    action,
    acknowledgement: ForumStepAcknowledgementSchema.parse({
      step,
      journalSha256,
    }),
  };
}
/** Baked producer capability, not a runtime behavior toggle. */
export const FORUM_RECOVERY_IMAGE_LABEL = "red.sjer.delivery.forum-recovery";
export const FORUM_RECOVERY_IMAGE_ABI = "storm-forum-recovery/v1";
export const FORUM_RECOVERY_ANNOTATIONS = {
  intent: "delivery.shepherdjerred.com/content-recovery-intent",
  action: "delivery.shepherdjerred.com/content-recovery-action",
  originalUID: "delivery.shepherdjerred.com/original-job-uid",
  originalName: "delivery.shepherdjerred.com/original-job-name",
  request: "delivery.shepherdjerred.com/content-recovery-request",
} as const;
