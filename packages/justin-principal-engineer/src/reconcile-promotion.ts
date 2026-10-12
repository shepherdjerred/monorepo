import type { TaskState } from "#src/domain/schemas.ts";
import { AutonomousBlocker } from "#src/domain/autonomy.ts";
import type { GitWorkspace } from "#src/host/git-workspace.ts";
import type { WithGitHub } from "#src/reconcile-merge.ts";
import { writeInfo } from "#src/runtime/output.ts";

export function needsAutonomyReview(state: TaskState): boolean {
  return (
    state.deliveryMode === "autonomous" &&
    state.autonomyReviewPending &&
    state.prNumber !== null &&
    ["publishing", "awaiting_ci", "awaiting_approval", "merging"].includes(
      state.phase,
    )
  );
}

export async function queueAutonomyReview(input: {
  state: TaskState;
  baseBranch: string;
  git: Pick<GitWorkspace, "restack">;
  withGitHub: WithGitHub;
  save: (
    state: TaskState,
    phase: TaskState["phase"],
    patch?: Partial<TaskState>,
  ) => Promise<TaskState>;
}): Promise<void> {
  const { state } = input;
  const number = state.prNumber;
  if (number === null)
    throw new Error("Autonomy review requires an existing PR");
  await input.withGitHub(async (github, env) => {
    const pr = await github.pullRequest(number);
    if (pr.headRefName !== state.branch || pr.baseRefName !== input.baseBranch)
      throw new AutonomousBlocker(
        "The PR branch changed before autonomous review",
      );
    if (pr.mergedAt !== null) {
      await input.save(state, "merging", {
        autonomyReviewPending: false,
        latestHeadSha: pr.headRefOid,
      });
      return;
    }
    // A resumed clean PR must be on the current base before a new coding turn.
    // Publishing may already contain uncommitted work; preserve that work.
    const conflict =
      state.phase === "publishing"
        ? null
        : await input.git.restack(state.checkoutPath, env);
    const reviews = await github.reviewDiagnostics(
      number,
      state.checkoutPath,
      pr.headRefOid,
    );
    const feedback = await github.feedback(
      number,
      new Set(state.seenFeedbackIds),
    );
    await input.save(state, "implementing", {
      latestHeadSha: pr.headRefOid,
      pendingDiagnostics: [
        state.pendingDiagnostics,
        "Before autonomous delivery, re-read the current ticket and its comments, inspect the complete existing PR, and complete every acceptance criterion and required regression test. Preserve prior work and address the host-collected review findings. Do not change CI or review policy.",
        conflict,
        reviews.text,
      ]
        .filter((part) => part !== null)
        .join("\n\n"),
      pendingFeedback: [
        ...new Map(
          [...state.pendingFeedback, ...feedback].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ],
      pendingReviewFindings: reviews.findings,
      pendingCodexFindingKeys: reviews.findings
        .filter((finding) => finding.provider === "codex")
        .map((finding) => finding.key),
      restackInProgress: conflict !== null || state.restackInProgress,
    });
    writeInfo(`${state.issue.identifier}: fresh autonomous review queued`);
  });
}
