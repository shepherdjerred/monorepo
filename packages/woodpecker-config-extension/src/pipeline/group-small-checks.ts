import type { CiStep, CiCommandStep } from "./model.ts";
import { GITHUB_DOWNLOAD } from "./lanes/tofu.ts";
import { BUN_CACHE, BUN_CACHE_CONTROL } from "./cache.ts";
import { MEDIUM_TIER } from "./tiers.ts";

/** Experimental: both selected checks retain their own grants and verdicts. */
export function groupSmallChecks(
  steps: readonly CiStep[],
  enabled: boolean,
  prVerification = true,
  credentialless = false,
): CiStep[] {
  if (!enabled || !prVerification || credentialless) return [...steps];
  const keys = new Set(["pr-dryrun", "alert-dashboard-sqlite"]);
  const checks = steps.filter((step) => keys.has(step.key));
  const first = checks[0];
  if (first === undefined || checks.length !== 2) return [...steps];
  const commands: CiCommandStep[] = checks.map((step) => {
    if (
      step.image !== first.image ||
      step.services !== undefined ||
      step.orderedSteps !== undefined ||
      step.skipClone === true ||
      step.commands[1]?.startsWith(
        "ci/scripts/bun-install.sh --frozen-lockfile",
      ) !== true
    )
      throw new Error("Small-check grouping setup contract changed");
    return {
      key: step.key,
      image: step.image,
      commands: [
        "test -f .git/ci-small-checks-ready",
        step.commands[0] ?? "",
        ...step.commands.slice(2),
      ],
      timeoutMinutes: step.timeoutMinutes,
      resources: step.resources,
      runAfterFailure: true,
      ...(step.secrets === undefined ? {} : { secrets: step.secrets }),
      ...(step.environment === undefined
        ? {}
        : { environment: step.environment }),
    };
  });
  const dependencies = [
    ...new Set(checks.flatMap((step) => step.dependsOn ?? [])),
  ].filter((key) => !keys.has(key));
  const group: CiStep = {
    key: "small-pr-checks",
    label: "release rehearsal and SQLite checks",
    image: first.image,
    commands: [
      ". ci/scripts/toolchain.sh",
      "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter '@shepherdjerred/release-tools' --filter '@shepherdjerred/llm-models' --filter homelab --filter '@homelab/cdk8s' --filter '@shepherdjerred/alert-dashboard'",
      "touch .git/ci-small-checks-ready",
    ],
    timeoutMinutes: 10,
    resources: MEDIUM_TIER,
    secrets: [GITHUB_DOWNLOAD],
    volumes: [BUN_CACHE, BUN_CACHE_CONTROL],
    orderedSteps: commands,
    dependsOn: dependencies,
  };
  return steps.flatMap((step) =>
    step === first
      ? [group]
      : keys.has(step.key)
        ? []
        : [
            {
              ...step,
              ...(step.dependsOn === undefined
                ? {}
                : {
                    dependsOn: [
                      ...new Set(
                        step.dependsOn.map((key) =>
                          keys.has(key) ? group.key : key,
                        ),
                      ),
                    ],
                  }),
            },
          ],
  );
}
