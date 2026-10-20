import { z } from "zod";
import { IdentifierSchema } from "#shared/artifact-contract.ts";

/**
 * Approval (model 4.13): a separate authenticated decision on one
 * deployment's frozen selection. `expired` records that the binding
 * generation moved or a bound Tofu plan was consumed (H2); `override` marks
 * the approval a non-eligible `deploy` needs (H4).
 */
export const ApprovalStatusSchema = z.enum([
  "pending",
  "granted",
  "rejected",
  "expired",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalV2InputSchema = z.strictObject({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1).max(4000),
  override: z.boolean().default(false),
});
export type ApprovalV2Input = z.infer<typeof ApprovalV2InputSchema>;

/**
 * One row per deployment, created `pending` with the request and without an
 * approver (H1); a decision records the actor and reason; expiry records
 * when it lapsed whether or not a decision was taken.
 */
export const ApprovalV2Schema = z
  .strictObject({
    id: IdentifierSchema,
    deploymentId: IdentifierSchema,
    actor: z.string().min(1).nullable(),
    status: ApprovalStatusSchema,
    override: z.boolean(),
    reason: z.string().min(1).max(4000).nullable(),
    createdAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
  })
  .superRefine((approval, context) => {
    if ((approval.status === "pending") !== (approval.decidedAt === null)) {
      context.addIssue({
        code: "custom",
        message: "A decided or expired approval records when it was settled",
      });
    }
    if (
      approval.status === "pending" &&
      (approval.actor !== null || approval.reason !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A pending approval has no approver and no reason yet",
      });
    }
    if (
      (approval.status === "granted" || approval.status === "rejected") &&
      (approval.actor === null || approval.reason === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A granted or rejected approval records the approver and the reason",
      });
    }
  });
export type ApprovalV2 = z.infer<typeof ApprovalV2Schema>;
