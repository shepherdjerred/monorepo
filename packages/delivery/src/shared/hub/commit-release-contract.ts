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
 * A release that ships a failed pipeline's change and has landed in every
 * environment it reached: live there, or superseded by a newer accepted
 * release that is deployed. Releases still held back are named by the
 * commit's blockers instead.
 */
export const CarriedReleaseSchema = z.object({
  service: z.string(),
  revision: z.number().int().positive(),
  /** The commit whose pipeline built the release. */
  includedIn: z.string().min(7),
  state: z.enum(["live", "superseded"]),
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
