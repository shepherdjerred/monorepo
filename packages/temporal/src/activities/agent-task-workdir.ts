import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { provisionWorkdir } from "#lib/pr-review-workdir.ts";
import {
  AgentTaskInputSchema,
  type AgentTaskInput,
} from "#shared/agent-task.ts";
import { workflowId } from "./agent-task-runtime.ts";

export type PrepareAgentTaskWorkdirInput = {
  input: AgentTaskInput;
};
export type PrepareAgentTaskWorkdirResult = {
  workdir: string;
};

function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo, extra] = fullName.split("/");
  if (owner === undefined || repo === undefined || extra !== undefined) {
    throw new Error(`Invalid repo fullName: ${fullName}`);
  }
  return { owner, repo };
}

export async function prepareAgentTaskWorkdir(
  input: PrepareAgentTaskWorkdirInput,
): Promise<PrepareAgentTaskWorkdirResult> {
  const parsed = AgentTaskInputSchema.parse(input.input);
  const { owner, repo } = splitRepo(parsed.repo.fullName);
  const tokenResult = await createGitHubAppInstallationToken();
  const workdir = await provisionWorkdir({
    workflowId: workflowId(),
    owner,
    repo,
    ref: parsed.repo.ref ?? "main",
    env: { GH_TOKEN: tokenResult.token },
  });
  return { workdir };
}
