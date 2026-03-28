/**
 * Version commit-back step generator.
 */
import { RETRY } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function versionCommitBackStep(dependsOn: string[]): BuildkiteStep {
  return {
    label: ":bookmark: Version Commit-Back",
    key: "version-commit-back",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: ".buildkite/scripts/version-commit-back.sh",
    timeout_in_minutes: 10,
    retry: RETRY,
    plugins: [k8sPlugin({ secrets: [] })],
  };
}
