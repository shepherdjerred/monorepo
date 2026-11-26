import { z } from "zod";
import { DeploymentStatusSchema } from "#shared/contract.ts";

/**
 * A release as one environment saw it, for a row that names the release
 * (r346): that release's own newest deployment there, which can differ from
 * the deployment the environment's state comes from, and, when a newer
 * accepted release carries the change instead, which one.
 */
export const CommitEnvironmentReleaseSchema = z.object({
  revision: z.number().int().positive(),
  /** The release's own newest deployment to this environment; null when none was made. */
  status: DeploymentStatusSchema.nullable(),
  /** The accepted release's revision when the environment's state is `superseded`. */
  supersededBy: z.number().int().positive().optional(),
});
export type CommitEnvironmentRelease = z.infer<
  typeof CommitEnvironmentReleaseSchema
>;

/**
 * A release that ships a carried change and has landed in every environment
 * it reached: `live` when it is still the accepted release somewhere, else
 * `superseded` by a newer accepted release that is deployed. `outcome` is
 * how its own deployments ended when one failed (it wins) or was canceled;
 * absent when they succeeded or none was made. Releases still held back are
 * named by the commit's blockers instead.
 */
export const CarriedReleaseSchema = z.object({
  service: z.string(),
  revision: z.number().int().positive(),
  /** The commit whose pipeline built the release. */
  includedIn: z.string().min(7),
  state: z.enum(["live", "superseded"]),
  outcome: z.enum(["failed", "canceled"]).optional(),
});
export type CarriedRelease = z.infer<typeof CarriedReleaseSchema>;

/**
 * What Woodpecker's stored pipeline says about a commit whose own record
 * holds no title or author: the pipeline's message title and its author.
 */
export const CommitPipelineNoteSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().nullable(),
  author: z.string().nullable(),
});
export type CommitPipelineNote = z.infer<typeof CommitPipelineNoteSchema>;

/**
 * What a commit's own pipeline built and passed: how many services in all,
 * and how many of them changed (the rest built with nothing to deploy).
 * Zero services means no service was built on its own, so a carried failure
 * is the whole commit.
 */
export const BuiltSchema = z.object({
  services: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
});
export type Built = z.infer<typeof BuiltSchema>;
