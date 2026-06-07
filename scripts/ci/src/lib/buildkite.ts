import type { BuildkiteStep } from "./types.ts";
import { k8sPlugin, k8sPluginWithCheckout } from "./k8s-plugin.ts";

/** Convert a name to a Buildkite-safe step key. */
export function safeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:-]/g, "-");
}

// ---------------------------------------------------------------------------
// Git-URL Directory refs — eliminate per-pod checkout cost
// ---------------------------------------------------------------------------
//
// Each Buildkite pod used to clone the repo into its emptyDir (1.3 GiB per
// pod × ~1,100 pods/hr = 92% of writes to the system NVMe). Dagger accepts
// `Directory`/`File` arguments as git URL refs of the form
// `https://github.com/<owner>/<repo>.git#<commit>:<subpath>`. The engine
// resolves them server-side (content-addressed by SHA, fetched once per
// unique SHA), so the BK pod does NO local clone. Per-pod writes drop from
// ~1.3 GiB to ~10–30 MiB.
//
// Combined with `kubernetes.checkout: { skip: true }` in `k8s-plugin.ts`,
// this is the PR1 of the BK-pressure reduction plan (see
// packages/docs/plans/2026-05-31_bk-dagger-git-url-refactor.md).

/** Public monorepo URL — used to build Dagger CLI git-URL Directory args. */
export const REPO_GIT_URL = "https://github.com/shepherdjerred/monorepo.git";

/**
 * Git-URL ref interpolated by `buildkite-agent pipeline upload` at upload
 * time. Single `$` so the agent substitutes the real SHA into each step's
 * command before baking it into the rendered pipeline YAML. (See
 * `OTEL_RESOURCE_ATTRIBUTES` below for the same precedent.)
 */
export const REPO_GIT_REF = `${REPO_GIT_URL}#$BUILDKITE_COMMIT`;

/** Build a Dagger `Directory` arg pointing at a subdir of the repo at `$BUILDKITE_COMMIT`. */
export function gitDir(subdir: string): string {
  return `${REPO_GIT_REF}:${subdir}`;
}

/** Build a Dagger `File` arg pointing at a file in the repo at `$BUILDKITE_COMMIT`. */
export function gitFile(path: string): string {
  return `${REPO_GIT_REF}:${path}`;
}

/**
 * Dagger module ref used by every BK pod's `dagger call`. With
 * `checkout: { skip: true }` there's no local `dagger.json` for the CLI
 * to discover — without `-m` the CLI errors with
 * `unknown command "<fn>" for "dagger call"`. The module-ref form uses
 * `@<ref>` (not `#<ref>` like Directory args), and the trailing `/.dagger`
 * matches `source` in our `dagger.json`.
 */
export const DAGGER_MOD_REF = `github.com/shepherdjerred/monorepo/.dagger@$BUILDKITE_COMMIT`;

/** Canonical `dagger call` prefix for BK steps. Use everywhere instead of
 *  bare `dagger call`. */
export const DAGGER_CALL = `dagger -m ${DAGGER_MOD_REF} call`;

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

export const GITHUB_APP_SECRET_ARGS = [
  "--github-app-id env:GITHUB_APP_ID",
  "--github-app-installation-id env:GITHUB_APP_INSTALLATION_ID",
  "--github-app-private-key env:GITHUB_APP_PRIVATE_KEY",
].join(" ");

export const TOFU_GITHUB_TOKEN_ARG = "--github-token env:TOFU_GITHUB_TOKEN";

/**
 * Claude Code subscription token used by CI steps that invoke `claude -p`.
 * Sourced from the `buildkite-ci-secrets` k8s secret (1Password-synced — the
 * `CLAUDE_CODE_OAUTH_TOKEN` field must exist on item
 * `rzk3lawpk4yspyyu5rxlz44ssi` for the env var to be present in the agent pod).
 */
export const CLAUDE_OAUTH_SECRET_ARG =
  "--claude-oauth-token env:CLAUDE_CODE_OAUTH_TOKEN";

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
  // Ship Dagger's per-exec stdout/stderr to Loki as OTLP log records so each
  // Dagger span's container output is queryable in Grafana via the
  // "Logs for this span" link. Dagger's OTel client deliberately does NOT
  // fan the generic OTLP endpoint out to logs (per dagger/otel-go init.go:
  // "we can't assume all OTLP endpoints support logs/metrics") — so this
  // signal-specific endpoint is required. The protocol inherits from
  // OTEL_EXPORTER_OTLP_PROTOCOL above; Loki's OTLP receiver accepts both
  // http/protobuf and http/json content types.
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://loki-gateway.loki/otlp/v1/logs",
};

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

/**
 * Create a plain Buildkite step that runs directly on the CI agent pod with a
 * shallow repo checkout (via {@link k8sPluginWithCheckout}).
 *
 * Use only for checks that need bash/bun/git operating on the working tree and
 * have no Dagger function yet — currently just the PR-only Greptile review gate.
 * Most steps should use {@link daggerStep} instead, which reads the repo via a
 * git-URL ref so the BK pod writes no source to disk.
 */
export function plainStep(opts: {
  label: string;
  key: string;
  command: string;
  timeoutMinutes?: number;
  dependsOn?: string | string[];
  softFail?: boolean;
  artifactPaths?: string[];
  secrets?: string[];
}): BuildkiteStep {
  const step: BuildkiteStep = {
    label: opts.label,
    key: opts.key,
    command: opts.command,
    timeout_in_minutes: opts.timeoutMinutes ?? 10,
    retry: RETRY,
    plugins: [
      k8sPluginWithCheckout(
        opts.secrets !== undefined ? { secrets: opts.secrets } : {},
      ),
    ],
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
