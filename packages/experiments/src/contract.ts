import { z } from "zod";

export const EXPERIMENTS_API_PATH = "/api/v1/experiments";
export const EXPERIMENTS_REVIEW_SUMMARY_PATH = "/internal/v1/review-summary";
export const EXPERIMENTS_OPERATOR_HEADER = "X-Experiments-Operator";
export const EXPERIMENTS_MAX_BODY_BYTES = 384 * 1024;

export const ExperimentIdSchema = z.uuid().toLowerCase();
export const ExperimentStatusSchema = z.enum(["draft", "running", "decided"]);
export const ExperimentViewSchema = z.enum([
  "all",
  "due",
  "running",
  "drafts",
  "decided",
]);
export const ExperimentDecisionSchema = z.enum([
  "keep",
  "revert",
  "inconclusive",
]);
export const ExperimentReviewOutcomeSchema = ExperimentDecisionSchema.or(
  z.literal("extend"),
);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const headline = z.string().trim().min(1).max(200);
const text = z.string().trim().max(8000);
const requiredText = text.min(1);
const revision = z.int().positive();

export const ExperimentPlanSchema = z.strictObject({
  change: text,
  hypothesis: text,
  scope: text,
  successCriteria: text,
  measurementMethod: text,
  baseline: text,
  guardrails: text,
});

const deployment = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u)
  .max(150);
const flagKey = z
  .string()
  .regex(/^[a-zA-Z0-9][\w.-]*$/u)
  .max(150);

export const ExperimentLinkSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("tracker"),
    issue: z
      .string()
      .regex(/^[A-Z][A-Z0-9]*-[1-9]\d*$/u)
      .max(32),
  }),
  z.strictObject({ kind: z.literal("flag"), deployment, key: flagKey }),
  z.strictObject({
    kind: z.literal("url"),
    label: headline,
    url: z
      .string()
      .max(2048)
      .pipe(z.url({ protocol: /^https?$/u }))
      .refine((raw) => {
        const url = new URL(raw);
        return url.username === "" && url.password === "";
      }, "Links cannot contain URL credentials"),
  }),
]);

export const FlagChangeSchema = z.strictObject({
  deployment,
  key: flagKey,
  before: text,
  after: text,
  revision: z.int().nonnegative(),
  changedAt: timestamp,
});

const attribution = { actor: headline, at: timestamp, revision };
export const ExperimentEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...attribution, kind: z.literal("created") }),
  z.strictObject({ ...attribution, kind: z.literal("edited") }),
  z.strictObject({ ...attribution, kind: z.literal("started") }),
  z.strictObject({
    ...attribution,
    kind: z.literal("amendment"),
    rationale: requiredText,
    plan: ExperimentPlanSchema,
  }),
  z.strictObject({
    ...attribution,
    kind: z.literal("link"),
    link: ExperimentLinkSchema,
  }),
  z.strictObject({
    ...attribution,
    kind: z.literal("evidence"),
    note: requiredText,
    link: ExperimentLinkSchema.optional(),
    flagChange: FlagChangeSchema.optional(),
  }),
  z.strictObject({
    ...attribution,
    kind: z.literal("review"),
    outcome: ExperimentReviewOutcomeSchema,
    rationale: requiredText,
    reviewDate: date.optional(),
  }),
]);

export const ExperimentSummarySchema = z.strictObject({
  id: ExperimentIdSchema,
  revision,
  title: headline,
  owner: headline,
  status: ExperimentStatusSchema,
  reviewDate: date.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  startedAt: timestamp.nullable(),
  decidedAt: timestamp.nullable(),
  isDue: z.boolean(),
  decision: ExperimentDecisionSchema.nullable(),
});

export const ExperimentSchema = ExperimentSummarySchema.extend({
  plan: ExperimentPlanSchema,
  originalPlan: ExperimentPlanSchema.nullable(),
  originalReviewDate: date.nullable(),
  timeline: z.array(ExperimentEventSchema),
});

export const ExperimentListSchema = z.strictObject({
  items: z.array(ExperimentSummarySchema),
});
export const ExperimentListQuerySchema = z.strictObject({
  view: ExperimentViewSchema.optional(),
  q: z.string().trim().max(200).optional(),
});

const requestId = z.uuid().toLowerCase();
const mutation = { requestId, expectedRevision: revision };
const draftFields = {
  plan: ExperimentPlanSchema.partial().optional(),
  reviewDate: date.nullable().optional(),
};

export const CreateExperimentSchema = z.strictObject({
  requestId,
  title: headline,
  owner: headline,
  ...draftFields,
});
export const EditExperimentSchema = z
  .strictObject({
    ...mutation,
    title: headline.optional(),
    owner: headline.optional(),
    ...draftFields,
  })
  .refine(
    ({ title, owner, plan, reviewDate }) =>
      title !== undefined ||
      owner !== undefined ||
      reviewDate !== undefined ||
      Object.keys(plan ?? {}).length > 0,
    "Provide at least one draft change",
  );
export const StartExperimentSchema = z.strictObject(mutation);
export const AmendExperimentSchema = z.strictObject({
  ...mutation,
  rationale: requiredText,
  plan: ExperimentPlanSchema.partial().refine(
    (plan) => Object.keys(plan).length > 0,
    "Provide at least one plan change",
  ),
});
export const LinkExperimentSchema = z.strictObject({
  ...mutation,
  link: ExperimentLinkSchema,
});
export const EvidenceExperimentSchema = z.strictObject({
  ...mutation,
  note: requiredText,
  link: ExperimentLinkSchema.optional(),
  flagChange: FlagChangeSchema.optional(),
});
export const ReviewExperimentSchema = z
  .strictObject({
    ...mutation,
    outcome: ExperimentReviewOutcomeSchema,
    rationale: requiredText,
    reviewDate: date.optional(),
  })
  .refine(
    ({ outcome, reviewDate }) =>
      (outcome === "extend") === (reviewDate !== undefined),
    "Provide a review date only when extending the experiment",
  );

export const ExperimentErrorSchema = z.strictObject({
  error: z.string(),
  code: z.string(),
});
export const ExperimentReviewSummarySchema = z.strictObject({
  dueCount: z.int().nonnegative(),
});

export type Experiment = z.infer<typeof ExperimentSchema>;
export type ExperimentSummary = z.infer<typeof ExperimentSummarySchema>;
export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>;
export type ExperimentEvent = z.infer<typeof ExperimentEventSchema>;
export type ExperimentLink = z.infer<typeof ExperimentLinkSchema>;
export type ExperimentListQuery = z.infer<typeof ExperimentListQuerySchema>;
export type ExperimentReviewOutcome = z.infer<
  typeof ExperimentReviewOutcomeSchema
>;
export type FlagChange = z.infer<typeof FlagChangeSchema>;
