import type { BuildkiteStep } from "./types.ts";
import { k8sPlugin } from "./k8s-plugin.ts";

/** Convert a name to a Buildkite-safe step key. */
export function safeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:-]/g, "-");
}

/** Standard retry configuration for CI steps. */
export const RETRY = {
  automatic: [
    { exit_status: -1, limit: 2 },
    { exit_status: 1, limit: 0 },
    { exit_status: 3, limit: 0 },
    { exit_status: 34, limit: 2 },
    { exit_status: 255, limit: 2 },
  ],
};

/**
 * Returns "--dryrun" when:
 * - `DRYRUN=true` is explicitly set, OR
 * - the pipeline is being generated for a non-default branch (PR builds).
 *
 * Lets PRs run the same deploy/release jobs as main but skip the production
 * side effect (S3 sync, ChartMuseum push, etc.). Without this, those steps
 * stay gated to `MAIN_ONLY` and PRs cannot validate them at all — which is
 * how renovate-481 broke main while showing green PR CI.
 */
function isPullRequestBranch(): boolean {
  const branch = process.env["BUILDKITE_BRANCH"];
  const defaultBranch = process.env["BUILDKITE_PIPELINE_DEFAULT_BRANCH"];
  if (branch === undefined || branch === "") return false;
  if (defaultBranch === undefined || defaultBranch === "") return false;
  return branch !== defaultBranch;
}
export const DRYRUN_FLAG =
  process.env["DRYRUN"] === "true" || isPullRequestBranch() ? " --dryrun" : "";

/** Dagger environment variables for CI steps. */
export const DAGGER_ENV: Record<string, string> = {
  DAGGER_NO_NAG: "1",
  DAGGER_NO_UPDATE_CHECK: "1",
  DAGGER_PROGRESS: "dots",
  // OTel exporter targets Tempo's in-cluster OTLP HTTP receiver. The Dagger CLI
  // (per dagger/otel-go init.go) auto-configures otlptracehttp from these env
  // vars, appending /v1/traces to the base endpoint when protocol is
  // http/protobuf. Engine-side spans are also routed through the same
  // exporter via params.EngineTrace, so we capture both client and engine
  // operations without touching the dagger-engine deployment.
  // OTEL_EXPORTER_OTLP_TRACES_LIVE is intentionally unset — Tempo expects
  // ended spans, not in-flight snapshots (Dagger's "live" mode is for the
  // Cloud streaming UI). Service name is overridden per-step in daggerStep.
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://tempo.tempo.svc.cluster.local:4318",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
  OTEL_SERVICE_NAME: "dagger-ci",
};

/**
 * Create a plain Buildkite step that runs directly on the CI agent pod.
 *
 * Use for checks that only need bash/bun/git (all in ci-base image) and
 * operate on the repo checkout. Avoids the overhead of copying the entire
 * repo into a Dagger container when no specialized toolchain is needed.
 */
export function plainStep(opts: {
  label: string;
  key: string;
  command: string;
  timeoutMinutes?: number;
  dependsOn?: string | string[];
  softFail?: boolean;
  artifactPaths?: string[];
}): BuildkiteStep {
  const step: BuildkiteStep = {
    label: opts.label,
    key: opts.key,
    command: opts.command,
    timeout_in_minutes: opts.timeoutMinutes ?? 10,
    retry: RETRY,
    plugins: [k8sPlugin()],
  };

  if (opts.dependsOn !== undefined) {
    step.depends_on = opts.dependsOn;
  }
  if (opts.softFail !== undefined) {
    step.soft_fail = opts.softFail;
  }
  if (opts.artifactPaths !== undefined) {
    step.artifact_paths = opts.artifactPaths;
  }

  return step;
}

/** Create a basic Buildkite step using dagger call. */
export function daggerStep(opts: {
  label: string;
  key: string;
  daggerCmd: string;
  timeoutMinutes?: number;
  dependsOn?: string | string[];
  condition?: string;
  softFail?: boolean;
  cpu?: string;
  memory?: string;
  secrets?: string[];
  concurrency?: number;
  concurrencyGroup?: string;
  artifactPaths?: string[];
  allowDependencyFailure?: boolean;
  priority?: number;
}): BuildkiteStep {
  // Per-step service name + Buildkite resource attributes. Build-level
  // variables use single `$` so `buildkite-agent pipeline upload` interpolates
  // them at upload time and bakes the real values into each step's env. The
  // step key is known at generation time and embedded directly. (`$$VAR` would
  // escape to a literal `$VAR` after upload — env values aren't shell-expanded
  // when applied to the job's environment, so the literal string would end up
  // as the OTel attribute value.)
  const stepEnv: Record<string, string> = {
    ...DAGGER_ENV,
    OTEL_SERVICE_NAME: `dagger-ci-${opts.key}`,
    OTEL_RESOURCE_ATTRIBUTES: [
      "service.namespace=monorepo",
      "deployment.environment=ci",
      "buildkite.build.number=$BUILDKITE_BUILD_NUMBER",
      "buildkite.branch=$BUILDKITE_BRANCH",
      "buildkite.commit=$BUILDKITE_COMMIT",
      "buildkite.pipeline=$BUILDKITE_PIPELINE_SLUG",
      `buildkite.step.key=${opts.key}`,
    ].join(","),
  };

  const step: BuildkiteStep = {
    label: opts.label,
    key: opts.key,
    command: opts.daggerCmd,
    timeout_in_minutes: opts.timeoutMinutes ?? 15,
    retry: RETRY,
    env: stepEnv,
    plugins: [
      k8sPlugin({
        ...(opts.cpu !== undefined ? { cpu: opts.cpu } : {}),
        ...(opts.memory !== undefined ? { memory: opts.memory } : {}),
        ...(opts.secrets !== undefined ? { secrets: opts.secrets } : {}),
      }),
    ],
  };

  if (opts.dependsOn !== undefined) {
    step.depends_on = opts.dependsOn;
  }
  if (opts.condition !== undefined) {
    step.if = opts.condition;
  }
  if (opts.softFail !== undefined) {
    step.soft_fail = opts.softFail;
  }
  if (opts.concurrency !== undefined) {
    step.concurrency = opts.concurrency;
  }
  if (opts.concurrencyGroup !== undefined) {
    step.concurrency_group = opts.concurrencyGroup;
  }
  if (opts.artifactPaths !== undefined) {
    step.artifact_paths = opts.artifactPaths;
  }
  if (opts.allowDependencyFailure !== undefined) {
    step.allow_dependency_failure = opts.allowDependencyFailure;
  }
  if (opts.priority !== undefined) {
    step.priority = opts.priority;
  }

  return step;
}
