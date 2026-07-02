/**
 * OpenTofu stack step generators.
 */
import { TOFU_STACKS, TOFU_STACK_LABELS } from "../catalog.ts";
import {
  RETRY,
  DAGGER_ENV,
  DRYRUN_FLAG,
  TOFU_GITHUB_TOKEN_ARG,
  REPO_GIT_REF,
  DAGGER_CALL,
} from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";
const PR_ONLY = "build.branch != pipeline.default_branch";

/**
 * Build the shared block of secret flags used by both `tofu-apply-all` and
 * `tofu-plan-all`. Every secret is passed unconditionally — the underlying
 * Dagger helpers conditionally bind only the ones a given stack consumes.
 */
function tofuSecretFlags(stacks: readonly string[]): string {
  const stackFlags = stacks.map((s) => `--stacks ${s}`).join(" ");
  return [
    stackFlags,
    `--aws-access-key-id env:SEAWEEDFS_ACCESS_KEY_ID`,
    `--aws-secret-access-key env:SEAWEEDFS_SECRET_ACCESS_KEY`,
    TOFU_GITHUB_TOKEN_ARG,
    `--cloudflare-account-id env:CLOUDFLARE_ACCOUNT_ID`,
    `--cloudflare-api-token env:CLOUDFLARE_API_TOKEN`,
    `--tailscale-oauth-client-id env:TAILSCALE_OAUTH_CLIENT_ID`,
    `--tailscale-oauth-client-secret env:TAILSCALE_OAUTH_CLIENT_SECRET`,
    `--buildkite-api-token env:BUILDKITE_API_TOKEN`,
    `--radarr-api-key env:RADARR_API_KEY`,
    `--sonarr-api-key env:SONARR_API_KEY`,
    `--prowlarr-api-key env:PROWLARR_API_KEY`,
    `--qbittorrent-password env:QBITTORRENT_PASSWORD`,
    `--privatehd-password env:PRIVATEHD_PASSWORD`,
    `--privatehd-pid env:PRIVATEHD_PID`,
    `--pagerduty-token env:PAGERDUTY_TOKEN`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Apply non-github Tofu stacks in parallel from one pod via `tofu-apply-all`.
 * Each stack writes to its own S3 backend, so concurrent applies are safe.
 * The github stack stays in its own (non-retrying) step — see
 * {@link homelabTofuApplyGithubStep} — because github API mutations are not
 * always idempotent on partial failure, so the original `retry: {}` policy
 * for that stack is preserved deliberately rather than swept into the bundle.
 */
const TOFU_BUNDLE_STACKS = TOFU_STACKS.filter((s) => s !== "github");

export function homelabTofuApplyAllStep(homelabPkgKey?: string): BuildkiteStep {
  const dependsOn = homelabPkgKey
    ? ["quality-gate", homelabPkgKey]
    : "quality-gate";
  const labels = TOFU_BUNDLE_STACKS.map((s) => TOFU_STACK_LABELS[s] ?? s).join(
    " + ",
  );
  return {
    label: `:terraform: Apply Tofu (${labels})`,
    key: "tofu-apply-all",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command:
      `${DAGGER_CALL} tofu-apply-all --source ${REPO_GIT_REF} ${tofuSecretFlags(TOFU_BUNDLE_STACKS)}` +
      DRYRUN_FLAG,
    timeout_in_minutes: 20,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "500m",
        memory: "1Gi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
  };
}

/**
 * GitHub stack apply runs in its own pod with no automatic retry, matching
 * the pre-bundle `retry: stack === "github" ? {} : RETRY` policy. github API
 * mutations (rulesets, etc.) aren't always idempotent on partial failure, so
 * a transient mid-apply error is better surfaced as a hard fail to a human
 * than re-tried blindly.
 */
export function homelabTofuApplyGithubStep(
  homelabPkgKey?: string,
): BuildkiteStep {
  const dependsOn = homelabPkgKey
    ? ["quality-gate", homelabPkgKey]
    : "quality-gate";
  return {
    label: `:terraform: Apply ${TOFU_STACK_LABELS["github"] ?? "GitHub Config"}`,
    key: "tofu-apply-github",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command:
      `${DAGGER_CALL} tofu-apply-all --source ${REPO_GIT_REF} ${tofuSecretFlags(["github"])}` +
      DRYRUN_FLAG,
    timeout_in_minutes: 10,
    priority: 1,
    retry: {},
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
  };
}

/**
 * Plan every Tofu stack in parallel from one pod via `tofu-plan-all`. Plans
 * are read-only; no concurrency group needed.
 */
export function homelabTofuPlanAllStep(): BuildkiteStep {
  const labels = TOFU_STACKS.map((s) => TOFU_STACK_LABELS[s] ?? s).join(" + ");
  return {
    label: `:terraform: Plan Tofu (${labels})`,
    key: "tofu-plan-all",
    if: PR_ONLY,
    command:
      `${DAGGER_CALL} tofu-plan-all --source ${REPO_GIT_REF} ${tofuSecretFlags(TOFU_STACKS)}` +
      DRYRUN_FLAG,
    timeout_in_minutes: 20,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "500m",
        memory: "1Gi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
  };
}
