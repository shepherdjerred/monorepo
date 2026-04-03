/**
 * OpenTofu stack step generators.
 */
import { TOFU_STACKS, TOFU_STACK_LABELS } from "../catalog.ts";
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";
const PR_ONLY = "build.branch != pipeline.default_branch";

function tofuStackStep(stack: string, homelabPkgKey?: string): BuildkiteStep {
  const label = TOFU_STACK_LABELS[stack] ?? stack;
  const dependsOn = homelabPkgKey ? ["release", homelabPkgKey] : "release";
  return {
    label: `:terraform: Apply ${label}`,
    key: `tofu-${stack}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command:
      [
        `dagger call tofu-apply --source . --stack ${stack}`,
        `--aws-access-key-id env:SEAWEEDFS_ACCESS_KEY_ID`,
        `--aws-secret-access-key env:SEAWEEDFS_SECRET_ACCESS_KEY`,
        `--gh-token env:TOFU_GITHUB_TOKEN`,
        `--cloudflare-account-id env:CLOUDFLARE_ACCOUNT_ID`,
        stack === "cloudflare"
          ? `--cloudflare-api-token env:CLOUDFLARE_API_TOKEN`
          : "",
      ]
        .filter(Boolean)
        .join(" ") + DRYRUN_FLAG,
    timeout_in_minutes: 15,
    concurrency: 1,
    concurrency_group: `monorepo/tofu-${stack}`,
    priority: 1,
    retry: RETRY,
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

function tofuPlanStep(stack: string): BuildkiteStep {
  const label = TOFU_STACK_LABELS[stack] ?? stack;
  return {
    label: `:terraform: Plan ${label}`,
    key: `tofu-plan-${stack}`,
    if: PR_ONLY,
    command:
      [
        `dagger call tofu-plan --source . --stack ${stack}`,
        `--aws-access-key-id env:SEAWEEDFS_ACCESS_KEY_ID`,
        `--aws-secret-access-key env:SEAWEEDFS_SECRET_ACCESS_KEY`,
        `--gh-token env:TOFU_GITHUB_TOKEN`,
        `--cloudflare-account-id env:CLOUDFLARE_ACCOUNT_ID`,
        stack === "cloudflare"
          ? `--cloudflare-api-token env:CLOUDFLARE_API_TOKEN`
          : "",
      ]
        .filter(Boolean)
        .join(" ") + DRYRUN_FLAG,
    timeout_in_minutes: 15,
    concurrency: 1,
    concurrency_group: `monorepo/tofu-plan-${stack}`,
    retry: RETRY,
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

export function homelabTofuGroup(homelabPkgKey?: string): BuildkiteGroup {
  return {
    group: ":terraform: Homelab Tofu",
    key: "homelab-tofu",
    steps: TOFU_STACKS.map((stack) => tofuStackStep(stack, homelabPkgKey)),
  };
}

export function homelabTofuPlanGroup(): BuildkiteGroup {
  return {
    group: ":terraform: Homelab Tofu Plan",
    key: "homelab-tofu-plan",
    steps: TOFU_STACKS.map(tofuPlanStep),
  };
}
