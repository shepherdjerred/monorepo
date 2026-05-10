import { z } from "zod/v4";

export const FetcherInputSchema = z.object({});

export const DepsSummaryInputSchema = z.object({
  daysBack: z.number().int().positive().default(7),
});

export const DnsAuditInputSchema = z.object({});

export const GolinkSyncInputSchema = z.object({});

export const VacuumInputSchema = z.object({});

export const PrAgentInputSchema = z.object({
  kind: z.enum(["review", "summary"]),
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  commitSha: z.string().min(1),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  prTitle: z.string(),
  prAuthor: z.string(),
});

/**
 * Input to the structured pr-review pipeline (multi-specialist + verification).
 * Mirrors PrAgentInput but without the `kind` discriminator — the pipeline is
 * always "review".
 */
export const PrReviewPipelineInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  commitSha: z.string().min(1),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  prTitle: z.string(),
  prAuthor: z.string(),
});

export type FetcherInput = z.infer<typeof FetcherInputSchema>;
export type DepsSummaryInput = z.infer<typeof DepsSummaryInputSchema>;
export type DnsAuditInput = z.infer<typeof DnsAuditInputSchema>;
export type GolinkSyncInput = z.infer<typeof GolinkSyncInputSchema>;
export type VacuumInput = z.infer<typeof VacuumInputSchema>;
export type PrAgentInput = z.infer<typeof PrAgentInputSchema>;
export type PrReviewPipelineInput = z.infer<typeof PrReviewPipelineInputSchema>;
