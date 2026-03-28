/**
 * OpenTofu stack step generators.
 */
import { TOFU_STACKS, TOFU_STACK_LABELS } from "../catalog.ts";
import { RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

function tofuStackStep(stack: string): BuildkiteStep {
  const label = TOFU_STACK_LABELS[stack] ?? stack;
  return {
    label: `:terraform: Apply ${label}`,
    key: `tofu-${stack}`,
    if: MAIN_ONLY,
    depends_on: "release",
    command: `dagger call tofu-apply --source . --stack ${stack}`,
    timeout_in_minutes: 15,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({ cpu: "500m", memory: "1Gi", secrets: ["buildkite-argocd-token"] }),
    ],
  };
}

export function homelabTofuGroup(): BuildkiteGroup {
  return {
    group: ":terraform: Homelab Tofu",
    key: "homelab-tofu",
    steps: TOFU_STACKS.map(tofuStackStep),
  };
}
