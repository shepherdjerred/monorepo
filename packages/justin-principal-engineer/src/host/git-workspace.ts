import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { AgentOutput, Config, TaskState } from "#src/domain/schemas.ts";
import { safeOutputForPublication } from "#src/agent/public-output.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";

function splitZero(value: string): string[] {
  return value.split("\0").filter((entry) => entry !== "");
}

export function branchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `agent/${identifier.toLowerCase()}-${slug || "task"}`;
}

export class GitWorkspace {
  public constructor(
    private readonly config: Config,
    private readonly run: CommandRunner,
  ) {}

  private async command(
    checkout: string,
    args: readonly string[],
    env?: Readonly<Record<string, string>>,
  ): Promise<string> {
    return requireSuccess(
      `Command ${args[0] ?? ""}`,
      await this.run([...args], {
        cwd: checkout,
        ...(env === undefined ? {} : { env }),
      }),
    ).stdout;
  }

  public async create(
    checkout: string,
    branch: string,
    githubEnv: Readonly<Record<string, string>>,
  ): Promise<void> {
    if (this.config.repository.stableCheckout.includes("/.herdr/worktrees/")) {
      throw new Error(
        "repository.stableCheckout must point at a stable checkout, not a Herdr worktree",
      );
    }
    await mkdir(path.dirname(checkout), { recursive: true });
    if (!(await Bun.file(path.join(checkout, ".git", "HEAD")).exists())) {
      requireSuccess(
        "Task clone",
        await this.run([
          "git",
          "clone",
          "--no-local",
          this.config.repository.stableCheckout,
          checkout,
        ]),
      );
    }
    await this.command(
      checkout,
      [
        "git",
        "remote",
        "set-url",
        "origin",
        `https://github.com/${this.config.repository.slug}.git`,
      ],
      githubEnv,
    );
    await this.command(
      checkout,
      ["git", "fetch", "origin", this.config.repository.baseBranch],
      githubEnv,
    );
    await this.command(
      checkout,
      [
        "git",
        "checkout",
        "--detach",
        `origin/${this.config.repository.baseBranch}`,
      ],
      githubEnv,
    );
    await this.command(
      checkout,
      [
        "git",
        "branch",
        "--force",
        this.config.repository.baseBranch,
        `origin/${this.config.repository.baseBranch}`,
      ],
      githubEnv,
    );
    await this.command(
      checkout,
      ["git", "checkout", this.config.repository.baseBranch],
      githubEnv,
    );
    await this.command(
      checkout,
      [
        "git",
        "merge",
        "--ff-only",
        `origin/${this.config.repository.baseBranch}`,
      ],
      githubEnv,
    );
    await this.command(
      checkout,
      [
        "toolkit",
        "git-spice",
        "repo",
        "init",
        "--trunk",
        this.config.repository.baseBranch,
        "--remote",
        "origin",
        "--upstream",
        "origin",
        "--no-prompt",
      ],
      githubEnv,
    );
    const branchExists = await this.run(
      ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd: checkout, env: githubEnv },
    );
    if (branchExists.exitCode === 0) {
      await this.command(checkout, ["git", "checkout", branch], githubEnv);
    } else if (branchExists.exitCode === 1) {
      await this.command(
        checkout,
        [
          "toolkit",
          "git-spice",
          "branch",
          "create",
          branch,
          "--no-commit",
          "--no-prompt",
        ],
        githubEnv,
      );
    } else {
      requireSuccess("Inspect task branch", branchExists);
    }
    await this.command(
      checkout,
      ["git", "config", "user.name", this.config.github.botLogin],
      githubEnv,
    );
    await this.command(
      checkout,
      [
        "git",
        "config",
        "user.email",
        `${this.config.github.botLogin}@users.noreply.github.com`,
      ],
      githubEnv,
    );
  }

  public async changedPaths(checkout: string): Promise<string[]> {
    const [tracked, staged, untracked] = await Promise.all([
      this.command(checkout, ["git", "diff", "--name-only", "-z"]),
      this.command(checkout, ["git", "diff", "--cached", "--name-only", "-z"]),
      this.command(checkout, [
        "git",
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
    ]);
    return [
      ...new Set([
        ...splitZero(tracked),
        ...splitZero(staged),
        ...splitZero(untracked),
      ]),
    ].sort();
  }

  public async preparePublication(
    output: AgentOutput,
    checkout: string,
    linearContext: string | null,
  ): Promise<readonly [AgentOutput, string[]]> {
    const paths = await this.changedPaths(checkout);
    return [
      await safeOutputForPublication(output, checkout, paths, linearContext),
      paths,
    ];
  }

  public async commitAndSubmit(input: {
    state: TaskState;
    output: AgentOutput;
    githubEnv: Readonly<Record<string, string>>;
  }): Promise<void> {
    const paths = await this.changedPaths(input.state.checkoutPath);
    if (paths.length === 0) {
      throw new Error(
        "The agent completed without changing any tracked source",
      );
    }
    await this.command(input.state.checkoutPath, [
      "git",
      "add",
      "--",
      ...paths,
    ]);
    const verification =
      input.output.verification.length === 0
        ? "Not reported"
        : input.output.verification.map((item) => `- ${item}`).join("\n");
    const commitMessage = [
      input.output.commitTitle,
      "",
      "Why",
      input.state.issue.description ?? input.state.issue.title,
      "",
      "What",
      input.output.summary,
      "",
      "Verification",
      verification,
    ].join("\n");
    await this.command(
      input.state.checkoutPath,
      [
        "toolkit",
        "git-spice",
        "commit",
        "create",
        "--message",
        commitMessage,
        "--no-prompt",
      ],
      input.githubEnv,
    );
    await this.command(
      input.state.checkoutPath,
      [
        "toolkit",
        "git-spice",
        "branch",
        "submit",
        "--draft",
        "--title",
        input.state.issue.title,
        "--body",
        this.pullRequestBody(input.state, input.output),
        "--no-web",
        "--nav-comment=false",
        "--no-prompt",
      ],
      input.githubEnv,
    );
  }

  public async amendAndSubmit(input: {
    state: TaskState;
    output: AgentOutput;
    githubEnv: Readonly<Record<string, string>>;
  }): Promise<void> {
    const paths = await this.changedPaths(input.state.checkoutPath);
    if (paths.length === 0) {
      throw new Error("The follow-up agent turn did not change the workspace");
    }
    await this.command(input.state.checkoutPath, [
      "git",
      "add",
      "--",
      ...paths,
    ]);
    await this.command(
      input.state.checkoutPath,
      ["toolkit", "git-spice", "commit", "amend", "--no-edit", "--no-prompt"],
      input.githubEnv,
    );
    await this.command(
      input.state.checkoutPath,
      [
        "toolkit",
        "git-spice",
        "branch",
        "submit",
        "--update-only",
        "--force",
        "--no-web",
        "--nav-comment=false",
        "--no-prompt",
      ],
      input.githubEnv,
    );
  }

  public async continueRestackAndSubmit(input: {
    checkout: string;
    githubEnv: Readonly<Record<string, string>>;
  }): Promise<void> {
    const paths = await this.changedPaths(input.checkout);
    if (paths.length === 0) {
      throw new Error("The conflict repair did not change the workspace");
    }
    await this.command(input.checkout, ["git", "add", "--", ...paths]);
    await this.command(
      input.checkout,
      [
        "toolkit",
        "git-spice",
        "rebase",
        "continue",
        "--no-edit",
        "--no-prompt",
      ],
      input.githubEnv,
    );
    await this.command(
      input.checkout,
      [
        "toolkit",
        "git-spice",
        "branch",
        "submit",
        "--update-only",
        "--force",
        "--no-web",
        "--nav-comment=false",
        "--no-prompt",
      ],
      input.githubEnv,
    );
  }

  public async publishChanges(input: {
    state: TaskState;
    output: AgentOutput;
    githubEnv: Readonly<Record<string, string>>;
  }): Promise<void> {
    if (input.state.restackInProgress) {
      await this.continueRestackAndSubmit({
        checkout: input.state.checkoutPath,
        githubEnv: input.githubEnv,
      });
      return;
    }
    await this.amendAndSubmit(input);
  }

  public async submitExisting(input: {
    state: TaskState;
    output: AgentOutput;
    githubEnv: Readonly<Record<string, string>>;
  }): Promise<void> {
    await this.command(
      input.state.checkoutPath,
      [
        "toolkit",
        "git-spice",
        "branch",
        "submit",
        "--draft",
        "--title",
        input.state.issue.title,
        "--body",
        this.pullRequestBody(input.state, input.output),
        "--no-web",
        "--nav-comment=false",
        "--no-prompt",
      ],
      input.githubEnv,
    );
  }

  public async submitUpdate(
    state: TaskState,
    githubEnv: Readonly<Record<string, string>>,
  ): Promise<void> {
    await this.command(
      state.checkoutPath,
      [
        "toolkit",
        "git-spice",
        "branch",
        "submit",
        "--update-only",
        "--force",
        "--no-web",
        "--nav-comment=false",
        "--no-prompt",
      ],
      githubEnv,
    );
  }

  public async restack(
    checkout: string,
    githubEnv: Readonly<Record<string, string>>,
  ): Promise<string | null> {
    await this.command(
      checkout,
      ["git", "fetch", "origin", this.config.repository.baseBranch],
      githubEnv,
    );
    await this.command(
      checkout,
      [
        "git",
        "branch",
        "--force",
        this.config.repository.baseBranch,
        `origin/${this.config.repository.baseBranch}`,
      ],
      githubEnv,
    );
    const result = await this.run(
      ["toolkit", "git-spice", "branch", "restack", "--no-prompt"],
      { cwd: checkout, env: githubEnv },
    );
    if (result.exitCode === 0) return null;
    const conflicts = await this.command(checkout, [
      "git",
      "diff",
      "--name-only",
      "--diff-filter=U",
    ]);
    if (conflicts.trim() === "") {
      requireSuccess("Restack task branch", result);
    }
    return `Restack stopped with conflicts in:\n${conflicts}\n${result.stderr}`;
  }

  public pullRequestBody(state: TaskState, output: AgentOutput): string {
    const verification =
      output.verification.length === 0
        ? "- Not reported"
        : output.verification.map((item) => `- ${item}`).join("\n");
    return `## Why

${state.issue.description ?? state.issue.title}

Linear: ${state.issue.url}

## What

${output.summary}

## Verification

${verification}

## Live checks not run

- Deployment and live acceptance are not implied by PR CI.
`;
  }

  public async headSha(checkout: string): Promise<string> {
    const output = await this.command(checkout, ["git", "rev-parse", "HEAD"]);
    return output.trim();
  }
}
