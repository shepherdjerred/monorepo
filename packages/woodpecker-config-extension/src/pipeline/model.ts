/**
 * Provider-neutral description of one CI step.
 *
 * This is the shape the Buildkite pipeline already had — a keyed step with
 * dependencies, a changed-path guard, a resource tier, and an exact list of
 * credential grants. Keeping it as data rather than YAML is what lets the
 * selector and the emitter stay separate: selection decides WHICH steps run,
 * emission decides what Woodpecker is told to do.
 */

/** A credential grant: one key of one Kubernetes Secret, as one env var. */
export type SecretGrant = {
  /** Kubernetes Secret name, synced from 1Password by the operator. */
  readonly secret: string;
  /** Key within that Secret. */
  readonly key: string;
  /** Environment variable the step sees. */
  readonly env: string;
};

export type ResourceTier = {
  readonly cpuRequest: string;
  readonly cpuLimit: string;
  readonly memoryRequest: string;
  readonly memoryLimit: string;
  /**
   * Ephemeral storage bounds. Carried over deliberately: the CI node's quota
   * counts ephemeral-storage, and omitting it from a pod's resources once
   * froze the whole queue.
   */
  readonly ephemeralStorageRequest: string;
  readonly ephemeralStorageLimit: string;
};

export type ChangedPathGuard = {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
};

export type StepEvent = "push" | "pull_request";

export type StepVolume = {
  readonly claim: string;
  readonly path: string;
};

export type CiStep = {
  /** Stable identifier; also the generated workflow's filename. */
  readonly key: string;
  /** Human-facing name shown in the Woodpecker UI. */
  readonly label: string;
  /** Container image, digest-pinned. */
  readonly image: string;
  /** Shell commands, run in order. */
  readonly commands: readonly string[];
  /** Plain environment variables. Credentials go through `secrets`, never here. */
  readonly environment?: Readonly<Record<string, string>>;
  /** Keys of steps that must finish first. */
  readonly dependsOn?: readonly string[];
  /**
   * Wall-clock bound. Woodpecker has no per-step timeout — only a
   * pipeline-level one — so the emitter wraps the command in `timeout`.
   */
  readonly timeoutMinutes: number;
  /**
   * Attempts on failure. Woodpecker has no step retry, so the emitter wraps
   * the command in a loop. Omit for steps that are not safe to re-run.
   */
  readonly retries?: number;
  /** Serialization group. Woodpecker applies concurrency per workflow. */
  readonly concurrency?: {
    readonly limit: number;
    readonly group?: string;
  };
  readonly resources: ResourceTier;
  readonly secrets?: readonly SecretGrant[];
  /** Pre-provisioned PVCs mounted by name, e.g. the shared bun and uv caches. */
  readonly volumes?: readonly StepVolume[];
  /** Restrict to these events. Defaults to both push and pull_request. */
  readonly events?: readonly StepEvent[];
  /** Run only when matching files changed. */
  readonly changed?: ChangedPathGuard;
  /** Run only on the default branch. */
  readonly defaultBranchOnly?: boolean;
  /**
   * Treat a non-zero exit as advisory rather than failing the build.
   *
   * Reserved for optional scanners whose FINDINGS must not block a merge.
   * Note this also swallows scanner crashes, which the Buildkite lanes
   * deliberately distinguished by exit code inside the command itself — port
   * that logic with the step rather than relying on this flag alone.
   */
  readonly allowFailure?: boolean;
};
