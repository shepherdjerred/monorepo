import type { PullRequest } from "#src/integrations/github.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export async function mergeWithGitSpice(
  number: number,
  headSha: string,
  input: {
    repository: string;
    checkout: string;
    branch: string;
    readyCommand: readonly string[];
    env: Readonly<Record<string, string>>;
    run: CommandRunner;
    pullRequest: (number: number) => Promise<PullRequest>;
    command: (
      args: readonly string[],
      cwd?: string,
      executable?: string,
    ) => Promise<string>;
  },
): Promise<PullRequest> {
  const before = await input.pullRequest(number);
  if (before.headRefOid !== headSha || before.headRefName !== input.branch)
    throw new Error("PR changed before the merge request");
  // Documented Git-Spice hooks keep readiness and the merge mutation bound
  // to the host's durable head, never a newly discovered unverified revision.
  for (const [key, command] of [
    ["spice.merge.ready.command", input.readyCommand],
    [
      "spice.merge.command",
      [
        "gh",
        "api",
        `repos/${input.repository}/pulls/${String(number)}/merge`,
        "--method",
        "PUT",
        "--raw-field",
        `sha=${headSha}`,
        "--raw-field",
        "merge_method=squash",
        "--silent",
      ],
    ],
  ] as const) {
    await input.command(
      [
        "config",
        "--local",
        key,
        command.map((value) => shellQuote(value)).join(" "),
      ],
      input.checkout,
      "git",
    );
  }
  const result = await input.run(
    [
      "toolkit",
      "git-spice",
      "branch",
      "merge",
      "--branch",
      input.branch,
      "--method=squash",
      "--ready-timeout=0",
      "--merge-timeout=30s",
      "--no-prompt",
    ],
    { cwd: input.checkout, env: input.env },
  );
  const after = await input.pullRequest(number);
  if (after.mergedAt === null) {
    requireSuccess("Git-Spice merge", result);
    throw new Error("Git-Spice exited without a confirmed merge");
  }
  if (after.headRefOid !== headSha || after.mergeCommit === null)
    throw new Error(
      "Merge readback did not confirm the validated head and merge commit",
    );
  return after;
}
