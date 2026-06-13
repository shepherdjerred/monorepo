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

/**
 * Input for the SDK-native pr-summary workflow (Phase 7 of the SOTA PR
 * review bot plan). Distinct from PrAgentInput — the SDK transport replaces
 * the `claude -p` subprocess used by the legacy summary path, so no `kind`
 * discriminator is needed. Structurally identical to PrReviewPipelineInput
 * today but kept separate so the summary and review payloads can diverge
 * independently if needed (e.g. summary-specific length hints).
 */
export const PrSummaryInputSchema = z.object({
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
 * Input for `cancelBuildkiteBuildsWorkflow`. Started from the GitHub webhook
 * `closed` action (merge *or* plain close) to stop any still-active Buildkite
 * builds for the PR's branch — finished builds waste Kueue-capped CI capacity.
 * Cancellation is keyed on `branch` (Buildkite builds carry the branch; the PR
 * filter is less reliable). `commitSha` only feeds the idempotent workflow id,
 * and `merged` is for logging/metrics.
 */
export const CancelBuildkiteBuildsInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  branch: z.string().min(1),
  commitSha: z.string().min(1),
  merged: z.boolean(),
});

export type FetcherInput = z.infer<typeof FetcherInputSchema>;
export type DepsSummaryInput = z.infer<typeof DepsSummaryInputSchema>;
export type DnsAuditInput = z.infer<typeof DnsAuditInputSchema>;
export type GolinkSyncInput = z.infer<typeof GolinkSyncInputSchema>;
export type VacuumInput = z.infer<typeof VacuumInputSchema>;
export type PrAgentInput = z.infer<typeof PrAgentInputSchema>;
export type PrReviewPipelineInput = z.infer<typeof PrReviewPipelineInputSchema>;
export type PrSummaryInput = z.infer<typeof PrSummaryInputSchema>;
export type CancelBuildkiteBuildsInput = z.infer<
  typeof CancelBuildkiteBuildsInputSchema
>;
