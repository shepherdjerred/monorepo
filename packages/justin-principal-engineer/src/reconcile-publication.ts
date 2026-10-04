import type { TaskState } from "#src/domain/schemas.ts";
import type { DeliveryAuthorization } from "#src/host/delivery-authorization.ts";
import type { GitWorkspace } from "#src/host/git-workspace.ts";
import type { DockerAgentRunner } from "#src/host/docker.ts";
import type { LinearClient } from "#src/integrations/linear.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import type { WithGitHub } from "#src/reconcile-merge.ts";
import { captureEvidence } from "#src/host/evidence.ts";
import { writeInfo } from "#src/runtime/output.ts";

export async function publishTask(input: {
  state: TaskState;
  authorization: DeliveryAuthorization;
  git: GitWorkspace;
  linear: LinearClient;
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
  const linearContext = await input.linear.agentContext(state.issue.identifier);
  // Scan private-context leakage before executing or publishing task output.
  await input.git.preparePublication(output, state.checkoutPath, linearContext);
  const verification = await input.agent.verifyWorkspace(
    state.checkoutPath,
    await input.git.publicationPaths(state.checkoutPath),
  );
  const [safeOutput, changed] = await input.git.preparePublication(
    output,
    state.checkoutPath,
    linearContext,
    verification,
  );
  if (state.deliveryMode === "autonomous") {
    state = await input.authorization.authorizeAutonomous(state);
    await input.authorization.checkAutonomousScope(state);
  }
  await input.withGitHub(async (github, env) => {
    let pr = await github.pullRequestForBranch(state.branch);
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
    const resolved = await github.resolveFindings(
      pr.number,
      safeOutput.summary,
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
    await input.save(current, "awaiting_ci", { restackInProgress: false });
    writeInfo(`${state.issue.identifier}: ${pr.url} is waiting for CI`);
  });
}
