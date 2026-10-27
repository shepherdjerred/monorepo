import { z } from "zod/v4";
import { PromotionAgentResultSchema } from "#shared/promotion.ts";
const TaskUrl = z
  .string()
  .refine((value) => URL.canParse(value), "Expected a URL");
export const PromotionTaskResultSchema = PromotionAgentResultSchema.extend({
  performedAction: z.boolean(),
  nextEligibleAt: z.iso.datetime().nullable(),
  preparedContent: z.string().max(30_000),
  evidence: z
    .array(z.object({ url: TaskUrl, quote: z.string().min(1) }))
    .max(30),
  receipt: z
    .object({
      status: z.enum(["verified", "filtered", "rejected"]),
      url: TaskUrl,
      quote: z.string().min(5),
      occurrenceId: z.string().nullable(),
    })
    .nullable(),
});
export type PromotionTaskResult = z.infer<typeof PromotionTaskResultSchema>;

/** The model selects captured nodes; the parent supplies their exact URL/text. */
export const PromotionTaskDraftSchema = PromotionTaskResultSchema.extend({
  evidence: z
    .array(
      z.strictObject({
        observationId: z.string().regex(/^o[1-9]\d{0,3}$/),
        ref: z.string().min(1),
      }),
    )
    .max(30),
});
export const PromotionPreviewDraftSchema = PromotionTaskDraftSchema.extend({
  status: z.enum(["preview", "deferred", "blocked"]),
  performedAction: z.literal(false),
  receipt: z.null(),
});

/** A dry run cannot describe an existing placement as a newly verified action. */
export const PromotionPreviewResultSchema = PromotionTaskResultSchema.extend({
  status: z.enum(["preview", "deferred", "blocked"]),
  performedAction: z.literal(false),
  receipt: z.null(),
});
