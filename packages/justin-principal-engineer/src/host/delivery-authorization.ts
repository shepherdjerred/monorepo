import type { Config, TaskState } from "#src/domain/schemas.ts";
import {
  AutonomousBlocker,
  autonomyIssueBlocker,
} from "#src/domain/autonomy.ts";
import { autonomyEnabled } from "#src/host/autonomy-policy.ts";
import { assertAutonomousScope } from "#src/host/autonomy-scope.ts";
import type { GitWorkspace } from "#src/host/git-workspace.ts";
import type { LinearClient } from "#src/integrations/linear.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import type { WithGitHub } from "#src/reconcile-merge.ts";
import { deliveryIsHealthy } from "#src/domain/delivery-health.ts";

export class DeliveryAuthorization {
  public constructor(
    private readonly input: {
      config: Config;
      paths: RuntimePaths;
      linear: LinearClient;
      git: GitWorkspace;
      run: CommandRunner;
      withGitHub: WithGitHub;
    },
  ) {}
  public async authorizeAutonomous(state: TaskState): Promise<TaskState> {
    const issue = await this.input.linear.refreshIssue(state.issue.identifier);
    if (issue === null)
      throw new AutonomousBlocker("Autonomous issue disappeared");
    const blocker = autonomyIssueBlocker(issue);
    if (blocker !== null) throw new AutonomousBlocker(blocker);
    if (!(await autonomyEnabled(issue, this.input.paths)))
      throw new AutonomousBlocker("Autonomous delivery flag is disabled", true);
    await this.input.linear.resumeBlocked(issue);
    return { ...state, issue };
  }

  public async checkAutonomousScope(state: TaskState): Promise<void> {
    await assertAutonomousScope({
      checkout: state.checkoutPath,
      baseBranch: this.input.config.repository.baseBranch,
      paths: await this.input.git.publicationPaths(state.checkoutPath),
      run: this.input.run,
    });
  }

  public async mergeReady(state: TaskState): Promise<boolean> {
    if (state.deliveryMode === "autonomous") {
      if (state.autonomyReviewPending) return false;
      // This readiness hook is read-only; do not change task or Linear state.
      const issue = await this.input.linear.refreshIssue(
        state.issue.identifier,
      );
      if (
        issue === null ||
        autonomyIssueBlocker(issue) !== null ||
        !(await autonomyEnabled(issue, this.input.paths))
      )
        return false;
      await this.checkAutonomousScope(state);
    }
    if (state.prNumber === null || state.latestHeadSha === null) return false;
    const number = state.prNumber;
    return await this.input.withGitHub(async (github) => {
      const pr = await github.pullRequest(number);
      if (
        pr.baseRefName !== this.input.config.repository.baseBranch ||
        pr.headRefName !== state.branch
      )
        return false;
      if (pr.mergedAt !== null || pr.headRefOid !== state.latestHeadSha)
        return false;
      if (
        (await this.input.git.headSha(state.checkoutPath)) !==
        state.latestHeadSha
      )
        throw new AutonomousBlocker(
          "The PR head no longer matches the host task checkout",
        );
      if (
        !deliveryIsHealthy(await github.health(pr.number, state.checkoutPath))
      )
        return false;
      const approved =
        state.deliveryMode !== "owner_approved" ||
        (await github.hasExactHeadApproval(pr.number, pr.headRefOid));
      const feedback = await github.feedback(
        pr.number,
        new Set(state.seenFeedbackIds),
      );
      return approved && feedback.length === 0;
    });
  }
}
