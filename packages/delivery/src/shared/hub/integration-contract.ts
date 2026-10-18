import { z } from "zod";
import { LinkSchema } from "@shepherdjerred/ops-model/snapshot.ts";
import { PipelineStatusSchema } from "#shared/hub/hub-contract.ts";

const TimestampSchema = z.iso.datetime();

export const IntegrationSourceSchema = z.enum([
  "woodpecker",
  "github",
  "argocd",
]);
export type IntegrationSource = z.infer<typeof IntegrationSourceSchema>;

export const UnavailableReasonSchema = z.enum([
  "not-configured",
  "disabled",
  "not-applicable",
  "upstream-error",
  "timeout",
]);
export type UnavailableReason = z.infer<typeof UnavailableReasonSchema>;

/** Enrichment from an external system; its absence degrades one panel only. */
export function integrationSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("state", [
    z.object({
      state: z.literal("available"),
      data,
      fetchedAt: TimestampSchema,
      links: z.array(LinkSchema),
    }),
    z.object({
      state: z.literal("unavailable"),
      reason: UnavailableReasonSchema,
      detail: z.string(),
      links: z.array(LinkSchema),
    }),
  ]);
}

export const CiStageSchema = z.enum(["build", "test", "publish", "other"]);
export type CiStage = z.infer<typeof CiStageSchema>;

export const CiStepSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string(),
  status: PipelineStatusSchema,
  exitCode: z.number().int(),
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  url: z.url(),
});
export type CiStep = z.infer<typeof CiStepSchema>;

export const CiWorkflowSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string(),
  stage: CiStageSchema,
  status: PipelineStatusSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  steps: z.array(CiStepSchema),
});
export type CiWorkflow = z.infer<typeof CiWorkflowSchema>;

export const CiRunSchema = z.object({
  number: z.number().int().positive(),
  status: PipelineStatusSchema,
  event: z.string(),
  branch: z.string(),
  author: z.string(),
  message: z.string(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  url: z.url(),
  workflows: z.array(CiWorkflowSchema),
});
export type CiRun = z.infer<typeof CiRunSchema>;
export const CiRunIntegrationSchema = integrationSchema(CiRunSchema);
export type CiRunIntegration = z.infer<typeof CiRunIntegrationSchema>;

export const SourceChangeSchema = z.object({
  sha: z.string(),
  headline: z.string(),
  body: z.string(),
  committedAt: TimestampSchema,
  url: z.url(),
  authorName: z.string().nullable(),
  authorLogin: z.string().nullable(),
  pullRequest: z
    .object({
      number: z.number().int().positive(),
      title: z.string(),
      url: z.url(),
      mergedAt: TimestampSchema.nullable(),
      authorLogin: z.string().nullable(),
    })
    .nullable(),
});
export type SourceChange = z.infer<typeof SourceChangeSchema>;
export const SourceChangeIntegrationSchema =
  integrationSchema(SourceChangeSchema);
export type SourceChangeIntegration = z.infer<
  typeof SourceChangeIntegrationSchema
>;

export const ImageCheckSchema = z.object({
  component: z.string(),
  expected: z.string(),
  live: z.array(z.string()),
  matches: z.boolean(),
});
export type ImageCheck = z.infer<typeof ImageCheckSchema>;

export const ArgoRuntimeSchema = z.object({
  application: z.string(),
  syncStatus: z.string(),
  syncRevision: z.string().nullable(),
  healthStatus: z.string(),
  operationPhase: z.string().nullable(),
  operationMessage: z.string().nullable(),
  operationFinishedAt: TimestampSchema.nullable(),
  reconciledAt: TimestampSchema.nullable(),
  images: z.array(z.string()),
  imageChecks: z.array(ImageCheckSchema),
});
export type ArgoRuntime = z.infer<typeof ArgoRuntimeSchema>;
export const ArgoRuntimeIntegrationSchema =
  integrationSchema(ArgoRuntimeSchema);
export type ArgoRuntimeIntegration = z.infer<
  typeof ArgoRuntimeIntegrationSchema
>;
