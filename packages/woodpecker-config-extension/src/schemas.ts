import { z } from "zod";

/**
 * The slice of Woodpecker's configuration-extension request this service uses.
 *
 * Woodpecker sends considerably more than this (avatars, netrc, the committed
 * configuration files). Unknown keys are allowed through rather than
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
   * Account that owns the change: the pusher, or the account that opened the
   * pull request. Authenticated by the forge, not taken from commit metadata,
   * which anyone can write.
   */
  author: z.string(),
  /**
   * Account whose action produced this specific event. Equal to `author` on a
   * push; on a pull request it is whoever triggered the build, which need not
   * be the account that opened it.
   *
   * Empty for pipelines Woodpecker creates itself rather than from a webhook:
   * a manual trigger records only `author`, and a cron records neither.
   */
  sender: z.string(),
  /**
   * Whether the pull request comes from a fork.
   *
   * Woodpecker serialises this with `omitempty`, so it is absent rather than
   * `false` on every push and on same-repository pull requests. The default
   * reproduces that encoding; it is not a fallback for a field that went
   * missing, and `authorizePipeline` does not rely on it alone.
   */
  from_fork: z.boolean().default(false),
  /**
   * Forge URL for the change being built (the pull request, or the commit on
   * a push). Stamped onto each step pod so a measured pod links back to the
   * change that caused it. Woodpecker v3 names it `forge_url`.
   */
  forge_url: z.string(),
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
