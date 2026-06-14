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
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Apply every Tofu stack in parallel from one pod via `tofu-apply-all`. Each
 * stack writes to its own S3 backend, so concurrent applies are safe. Drops
 * the per-stack `concurrency: 1` group — that was only blocking parallel
 * applies of the SAME stack across branches; Tofu's state lock already
 * handles that case.
 */
export function homelabTofuApplyAllStep(homelabPkgKey?: string): BuildkiteStep {
  const dependsOn = homelabPkgKey
    ? ["quality-gate", homelabPkgKey]
    : "quality-gate";
  const labels = TOFU_STACKS.map((s) => TOFU_STACK_LABELS[s] ?? s).join(" + ");
  return {
    label: `:terraform: Apply Tofu (${labels})`,
    key: "tofu-apply-all",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command:
      `${DAGGER_CALL} tofu-apply-all --source ${REPO_GIT_REF} ${tofuSecretFlags(TOFU_STACKS)}` +
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
