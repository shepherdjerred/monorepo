import { z } from "zod";

/**
 * The slice of Woodpecker's configuration-extension request this service uses.
 *
 * Woodpecker sends considerably more than this (author, avatars, netrc, the
 * committed configuration files). Unknown keys are allowed through rather than
 * rejected so a Woodpecker upgrade that adds a field does not take CI down,
 * but every field read below is required — a missing one means the contract
 * changed and lane selection would silently fall back to running everything.
 */
export const PipelineSchema = z.looseObject({
  event: z.string(),
  branch: z.string(),
  commit: z.string(),
  ref: z.string(),
  /**
   * Files touched by this push or pull request. This is what replaces
   * Buildkite's `if_changed` inputs: lane selection reads it directly instead
   * of shelling out to git in a bootstrap pod.
   */
  changed_files: z.array(z.string()).default([]),
});

export const RepoSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  default_branch: z.string(),
});

export const ConfigExtensionRequestSchema = z.looseObject({
  repo: RepoSchema,
  pipeline: PipelineSchema,
});

export type ConfigExtensionRequest = z.infer<
  typeof ConfigExtensionRequestSchema
>;
export type Pipeline = z.infer<typeof PipelineSchema>;

export type GeneratedConfig = {
  /** Filename Woodpecker shows for the workflow. */
  readonly name: string;
  /** Workflow YAML. */
  readonly data: string;
};

export type ConfigExtensionResponse = {
  readonly configs: readonly GeneratedConfig[];
};
