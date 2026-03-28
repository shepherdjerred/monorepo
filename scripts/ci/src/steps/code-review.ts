/**
 * Code review step (PR only, soft_fail).
 */
import type { BuildkiteStep } from "../lib/types.ts";
import { RETRY } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";

export function codeReviewStep(): BuildkiteStep {
  return {
    label: ":robot_face: Code Review",
    key: "code-review",
    if: "build.pull_request.id != null",
    command: ".buildkite/scripts/code-review.sh",
    timeout_in_minutes: 30,
    soft_fail: true,
    retry: RETRY,
    plugins: [k8sPlugin({ secrets: [] })],
  };
}
