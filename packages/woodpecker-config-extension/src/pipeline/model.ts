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

/**
 * A long-running container beside the step, reachable over localhost.
 *
 * Woodpecker starts services before the step and stops them after, and they
 * share the step's workspace -- which is how a service can read a config file
 * committed to the repository instead of needing a mounted ConfigMap.
 */
export type StepService = {
  readonly name: string;
  readonly image: string;
  /** Shell commands replacing the image entrypoint. */
  readonly commands?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  /**
   * Required for the same reason a step's is: the service is its own pod,
   * admitted by Kueue before its step. Use `SERVICE_TIER` unless measured
   * usage says otherwise.
   */
  readonly resources: ResourceTier;
};

export type StepVolume = {
  readonly claim: string;
  readonly path: string;
};

export type CiStep = {
  /** Stable identifier; also the generated workflow's filename. */
  readonly key: string;
  /** Human-facing name shown in the Woodpecker UI. */
  readonly label: string;
  /**
   * Container image, digest-pinned.
   *
   * On the local backend this names the SHELL rather than an image, because
   * those steps run directly on the host with no container around them.
   */
  readonly image: string;
  /**
   * Which agent backend runs this step. Defaults to Kubernetes.
   *
   * `local` steps run directly on a host agent -- the Mac, for the native
   * Swift and Xcode lanes, which cannot run in a Linux container. They get no
   * pod spec and no Kubernetes secret grants, because there is no pod.
   */
  readonly backend?: "kubernetes" | "local";
  /**
   * Agent labels this step requires.
   *
   * Woodpecker matches these against agent labels to pick a runner; it is the
   * successor to Buildkite's `agents.queue`.
   */
  readonly agentLabels?: Readonly<Record<string, string>>;
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
  /**
   * Daemons started for the step. Each is its own pod, reachable from the
   * step by its `name` as a hostname -- not on localhost.
   */
  readonly services?: readonly StepService[];
  /** Restrict to these events. Defaults to both push and pull_request. */
  readonly events?: readonly StepEvent[];
  /** Run only when matching files changed. */
  readonly changed?: ChangedPathGuard;
  /**
   * Run only for the default branch itself, never for a proposed change to it.
   *
   * Not the same as "the branch is `main`": Woodpecker reports the target
   * branch for pull-request events, so branch identity alone would let every
   * pull request run these steps. `select.ts` also requires an event that
   * means the default branch actually moved.
   */
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
