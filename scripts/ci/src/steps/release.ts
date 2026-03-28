/**
 * Release-please step (main only).
 */
import { RETRY } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function releaseStep(): BuildkiteStep {
  return {
    label: ":bookmark: Release",
    key: "release",
    if: MAIN_ONLY,
    command: ".buildkite/scripts/release.sh",
    timeout_in_minutes: 10,
    retry: RETRY,
    plugins: [k8sPlugin({ secrets: [] })],
  };
}
