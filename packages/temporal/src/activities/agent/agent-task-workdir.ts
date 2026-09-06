import { provisionWorkdir } from "#lib/pr-review-workdir.ts";
import { providerSubprocessUid } from "#shared/agent/agent-subprocess-identity.ts";
import {
  AgentTaskInputSchema,
  type AgentTaskInput,
} from "#shared/agent/agent-task.ts";
import { workflowId } from "./agent-task-runtime.ts";

export type PrepareAgentTaskWorkdirInput = {
  input: AgentTaskInput;
};
export type PrepareAgentTaskWorkdirResult = {
  workdir: string;
};

async function grantProviderGroupWrite(workdir: string): Promise<void> {
  if (providerSubprocessUid() === undefined) {
    return;
  }
  const chmod = Bun.spawn(["chmod", "-R", "g+rwX", workdir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(chmod.stdout).text(),
    new Response(chmod.stderr).text(),
    chmod.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Unable to grant provider group write access to ${workdir} (exit ${String(exitCode)}): ${stdout}${stderr}`,
    );
  }
}

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
  const workdir = await provisionWorkdir({
    workflowId: workflowId(),
    owner,
    repo,
    ref: parsed.repo.ref ?? "main",
    env: {},
  });
  await grantProviderGroupWrite(workdir);
  return { workdir };
}
