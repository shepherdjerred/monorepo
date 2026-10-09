import type { CiCommandStep, CiStep } from "#src/pipeline/model.ts";
import { GITHUB_DOWNLOAD } from "#src/pipeline/lanes/tofu.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { BUN_CACHE, BUN_CACHE_CONTROL } from "#src/pipeline/cache.ts";

const SETUP = [
  ". ci/scripts/toolchain.sh",
  "ci/scripts/bun-install.sh --frozen-lockfile --filter homelab --production",
] as const;
const GROUP_KEYS = new Set([
  "tofu-plan-seaweedfs",
  "tofu-plan-tailscale",
  "tofu-plan-arr",
  "tofu-plan-github",
  "tofu-plan-cloudflare",
  "tofu-platforms-validate",
  "tofu-posthog-plan",
]);

function commandStep(step: CiStep): CiCommandStep {
  if (
    step.commands[0] !== SETUP[0] ||
    step.commands[1] !== SETUP[1] ||
    step.backend === "local" ||
    step.services !== undefined ||
    step.orderedSteps !== undefined ||
    step.concurrency !== undefined ||
    step.agentLabels !== undefined ||
    step.skipClone === true ||
    step.runOnFailure === true
  ) {
    throw new Error(
      `Unexpected setup contract for grouped workflow ${step.key}`,
    );
  }
  return {
    key: step.key,
    image: step.image,
    commands: [
      "MISE_TOOLCHAIN_SCOPE=tofu . ci/scripts/toolchain.sh",
      ...step.commands.slice(2),
    ],
    ...(step.environment === undefined
      ? {}
      : { environment: step.environment }),
    timeoutMinutes: step.timeoutMinutes,
    ...(step.shell === undefined ? {} : { shell: step.shell }),
    ...(step.retries === undefined ? {} : { retries: step.retries }),
    ...(step.allowFailure === undefined
      ? {}
      : { allowFailure: step.allowFailure }),
    resources: step.resources,
    ...(step.secrets === undefined ? {} : { secrets: step.secrets }),
    ...(step.volumes === undefined ? {} : { volumes: step.volumes }),
  };
}

/** Group after selection, retaining exactly the selected plans and grants. */
export function groupTofuSteps(selected: readonly CiStep[]): CiStep[] {
  const grouped = selected.filter((step) => GROUP_KEYS.has(step.key));
  const first = grouped[0];
  if (first === undefined) return [...selected];
  if (selected.some((step) => step.key === "tofu-pr")) {
    throw new Error(
      "OpenTofu grouping encountered an existing tofu-pr workflow",
    );
  }
  const keys = new Set(grouped.map((step) => step.key));
  const dependencies = [
    ...new Set(grouped.flatMap((step) => step.dependsOn ?? [])),
  ].filter((key) => !keys.has(key));
  const workflow: CiStep = {
    key: "tofu-pr",
    label: "OpenTofu PR checks",
    image: first.image,
    commands: ["MISE_TOOLCHAIN_SCOPE=tofu . ci/scripts/toolchain.sh", SETUP[1]],
    timeoutMinutes: 5,
    resources: MEDIUM_TIER,
    secrets: [GITHUB_DOWNLOAD],
    volumes: [BUN_CACHE, BUN_CACHE_CONTROL],
    orderedSteps: grouped.map((step) => commandStep(step)),
    ...(dependencies.length === 0 ? {} : { dependsOn: dependencies }),
  };
  return selected.flatMap((step) => {
    if (step === first) return [workflow];
    if (keys.has(step.key)) return [];
    return [
      {
        ...step,
        ...(step.dependsOn === undefined
          ? {}
          : {
              dependsOn: [
                ...new Set(
                  step.dependsOn.map((key) =>
                    keys.has(key) ? workflow.key : key,
                  ),
                ),
              ],
            }),
      },
    ];
  });
}
