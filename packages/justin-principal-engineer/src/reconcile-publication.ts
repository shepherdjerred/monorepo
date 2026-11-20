import type { TaskState } from "#src/domain/schemas.ts";
import { MAX_OPEN_PULL_REQUESTS } from "#src/domain/schemas.ts";
import type { DeliveryAuthorization } from "#src/host/delivery-authorization.ts";
import type { GitWorkspace } from "#src/host/git-workspace.ts";
import type { DockerAgentRunner } from "#src/host/docker.ts";
import type { TrackerClient } from "#src/integrations/tracker.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import type { WithGitHub } from "#src/reconcile-merge.ts";
import type { GitHubClient } from "#src/integrations/github.ts";
import { captureEvidence } from "#src/host/evidence.ts";
import { writeInfo } from "#src/runtime/output.ts";

async function publicationSlotAvailable(
  github: GitHubClient,
  state: TaskState,
) {
  const open = await github.openPullRequestNumbers();
  if (open.length < MAX_OPEN_PULL_REQUESTS) return true;
  writeInfo(`${state.issue.identifier}: waiting for a pull request slot`);
  return false;
}

async function pullRequestForPublication(
  state: TaskState,
  github: GitHubClient,
  baseBranch: string,
  save: Parameters<typeof publishTask>[0]["save"],
) {
  if (state.lastPass?.closedPullRequest !== true) {
    const pr = await github.pullRequestForBranch(state.branch);
    return pr !== null || (await publicationSlotAvailable(github, state))
      ? { state, pr }
      : null;
  }
  if (state.prNumber === null)
    throw new Error("Passed task has no pull request to reopen");
  const pr = await github.pullRequest(state.prNumber);
  if (pr.headRefName !== state.branch || pr.baseRefName !== baseBranch)
    throw new Error("Pull request branch changed before reopening");
  if (pr.state === "MERGED") {
    await save(state, "merging");
    return null;
  }
  if (pr.state === "CLOSED" && !(await publicationSlotAvailable(github, state)))
    return null;
  // Save the owner reviews before reopening. A resumed retry after a
  // successful reopen must still recognize approvals from the old attempt.
  const next =
    state.previousApprovalIds === undefined
      ? await save(state, "publishing", {
          previousApprovalIds: await github.approvalIds(pr.number),
        })
      : state;
  if (pr.state === "CLOSED") await github.setPullRequestOpen(pr.number, true);
  if (!pr.isDraft) await github.markDraft(pr.number);
  return { state: next, pr };
}

export async function publishTask(input: {
  state: TaskState;
  baseBranch: string;
  authorization: DeliveryAuthorization;
  git: GitWorkspace;
  tracker: TrackerClient;
  agent: DockerAgentRunner;
  paths: RuntimePaths;
  run: CommandRunner;
  withGitHub: WithGitHub;
  save: (
    state: TaskState,
    phase: TaskState["phase"],
    patch?: Partial<TaskState>,
  ) => Promise<TaskState>;
}): Promise<void> {
  let { state } = input;
  if (state.deliveryMode === "autonomous") {
    state = await input.authorization.authorizeAutonomous(state);
    await input.authorization.checkAutonomousScope(state);
  }
  const output = state.lastAgentOutput;
  if (output === null) throw new Error("Publishing state has no agent output");
  const trackerContext = await input.tracker.agentContext(
    state.issue.identifier,
  );
  // Scan private-context leakage before executing or publishing task output.
  await input.git.preparePublication(
    output,
    state.checkoutPath,
    trackerContext,
  );
  const verification = await input.agent.verifyWorkspace(
    state.checkoutPath,
    await input.git.publicationPaths(state.checkoutPath),
  );
  const [safeOutput, changed] = await input.git.preparePublication(
    output,
    state.checkoutPath,
    trackerContext,
    verification,
  );
  if (state.deliveryMode === "autonomous") {
    state = await input.authorization.authorizeAutonomous(state);
    await input.authorization.checkAutonomousScope(state);
  }
  await input.withGitHub(async (github, env) => {
    const publication = await pullRequestForPublication(
      state,
      github,
      input.baseBranch,
      input.save,
    );
    if (publication === null) return;
    state = publication.state;
    let { pr } = publication;
    const requested = [
      ...output.resolvedFindings,
      ...output.resolvedFindingKeys.map((key) => ({
        provider: "codex" as const,
        key,
      })),
    ];
    const pending = [
      ...state.pendingReviewFindings,
      ...state.pendingCodexFindingKeys.map((key) => ({
        provider: "codex" as const,
        key,
      })),
    ];
    const eligible = requested.filter((ref) =>
      pending.some(
        (value) => value.provider === ref.provider && value.key === ref.key,
      ),
    );
    // Host verification has passed. Resolve the addressed findings before
    // publication so the new head's review gate sees both code and thread state.
    const resolved =
      pr === null
        ? []
        : await github.resolveFindings(
            pr.number,
            `Agent-reported repair verified locally before publication. Reviewed base: ${pr.headRefOid}.\n\nHost checks:\n${verification.join("\n")}`,
            state.checkoutPath,
            eligible,
          );
    state = {
      ...state,
      pendingCodexFindingKeys: state.pendingCodexFindingKeys.filter(
        (key) =>
          !resolved.some((ref) => ref.provider === "codex" && ref.key === key),
      ),
      pendingReviewFindings: state.pendingReviewFindings.filter(
        (ref) =>
          !resolved.some(
            (value) => value.provider === ref.provider && value.key === ref.key,
          ),
      ),
    };
    if (pr === null) {
      if (changed.length > 0) {
        await input.git.commitAndSubmit({
          state,
          output: safeOutput,
          githubEnv: env,
        });
      } else {
        await input.git.submitExisting({
          state,
          output: safeOutput,
          githubEnv: env,
        });
      }
    } else if (changed.length > 0) {
      await input.git.publishChanges({
        state,
        output: safeOutput,
        githubEnv: env,
      });
    } else {
      const localHead = await input.git.headSha(state.checkoutPath);
      if (localHead !== pr.headRefOid) await input.git.submitUpdate(state, env);
    }
    pr = await github.pullRequestForBranch(state.branch);
    if (pr === null) throw new Error("No PR after submit");
    let current = await input.save(state, "publishing", {
      prNumber: pr.number,
      prUrl: pr.url,
      latestHeadSha: pr.headRefOid,
      lastAgentOutput: safeOutput,
    });
    if (!current.evidencePublished) {
      const evidence = await captureEvidence({
        output,
        checkout: state.checkoutPath,
        prNumber: pr.number,
        githubEnv: env,
        paths: input.paths,
        identifier: state.issue.identifier,
        run: input.run,
        capture: async (target) => {
          await input.agent.captureScreenshot({
            checkout: state.checkoutPath,
            ...target,
          });
        },
      });
      current = await input.save(current, "publishing", {
        evidencePublished: true,
        evidenceMarkdown: [...current.evidenceMarkdown, ...evidence],
      });
    }
    await github.updateBody(
      pr.number,
      `${input.git.pullRequestBody(state, safeOutput)}${
        current.evidenceMarkdown.length === 0
          ? ""
          : `\n## Visual evidence\n\n${current.evidenceMarkdown.join("\n\n")}\n`
      }`,
    );
    await input.save(current, "awaiting_ci", {
      restackInProgress: false,
      ...(current.lastPass === undefined
        ? {}
        : { lastPass: { ...current.lastPass, closedPullRequest: false } }),
    });
    writeInfo(`${state.issue.identifier}: ${pr.url} is waiting for CI`);
  });
}
