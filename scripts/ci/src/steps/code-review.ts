/**
 * Code review step (PR only, soft_fail).
 */
import { daggerStep } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

export function codeReviewStep(): BuildkiteStep {
  return daggerStep({
    label: ":robot_face: Code Review",
    key: "code-review",
    daggerCmd:
      'dagger call code-review --source . --pr-number "$BUILDKITE_PULL_REQUEST" --base-branch "$BUILDKITE_PULL_REQUEST_BASE_BRANCH" --commit-sha "$BUILDKITE_COMMIT" --gh-token env:GH_TOKEN --claude-token env:CLAUDE_CODE_OAUTH_TOKEN',
    timeoutMinutes: 30,
    condition: "build.pull_request.id != null",
    softFail: true,
  });
}
