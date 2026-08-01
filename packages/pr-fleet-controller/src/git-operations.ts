import { realpath } from "node:fs/promises";
import path from "node:path";
import { parseHeadSha, splitRepo } from "./evidence-parsers.ts";
import type { CommandRequest, CommandResult } from "./ports.ts";
import type { PrState } from "./schemas.ts";

type GitOperationsDependencies = {
  repo: string;
  run: (request: CommandRequest) => Promise<CommandResult>;
  mustRun: (
    executable: string,
    args: string[],
    cwd?: string,
    timeoutMs?: number,
  ) => Promise<string>;
};

export class GitOperations {
  readonly #repo: string;
  readonly #run: GitOperationsDependencies["run"];
  readonly #mustRun: GitOperationsDependencies["mustRun"];

  constructor(dependencies: GitOperationsDependencies) {
    this.#repo = dependencies.repo;
    this.#run = dependencies.run;
    this.#mustRun = dependencies.mustRun;
  }

  async #validatePaths(worktree: string, paths: string[]): Promise<string[]> {
    const canonicalRoot = await realpath(worktree);
    const validated: string[] = [];
    for (const requestedPath of paths) {
      if (
        path.isAbsolute(requestedPath) ||
        requestedPath.split("/").includes("..")
      ) {
        throw new Error(`Unsafe publication path: ${requestedPath}`);
      }
      const absolute = path.resolve(canonicalRoot, requestedPath);
      const canonicalParent = await realpath(path.dirname(absolute));
      const relativeParent = path.relative(canonicalRoot, canonicalParent);
      if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) {
        throw new Error(`Publication path escapes worktree: ${requestedPath}`);
      }
      validated.push(requestedPath);
    }
    return validated;
  }

  async startRestack(pr: PrState): Promise<CommandResult> {
    const worktree = this.#worktree(pr);
    return this.#run({
      executable: "git-spice",
      args: [
        "--no-prompt",
        "branch",
        "restack",
        "--branch",
        pr.identity.headRefName,
      ],
      cwd: worktree,
      timeoutMs: 600_000,
    });
  }

  async continueRestack(pr: PrState, paths: string[]): Promise<CommandResult> {
    const worktree = this.#worktree(pr);
    const validated = await this.#validatePaths(worktree, paths);
    if (validated.length === 0) {
      throw new Error("continueRestack requires explicit resolved paths");
    }
    await this.#mustRun("git", ["add", "--", ...validated], worktree);
    return this.#run({
      executable: "git-spice",
      args: ["--no-prompt", "rebase", "continue"],
      cwd: worktree,
      timeoutMs: 600_000,
    });
  }

  async publishFix(
    pr: PrState,
    paths: string[],
    message: string,
  ): Promise<{ headSha: string }> {
    const worktree = this.#worktree(pr);
    const validated = await this.#validatePaths(worktree, paths);
    if (validated.length === 0) {
      throw new Error("publishFix requires at least one explicit path");
    }
    // A reused worktree may already carry staged changes (e.g. a prior
    // continueRestack staged conflict resolutions before a failed continuation).
    // A plain `git commit` would sweep those into this commit despite the
    // explicit-path API, publishing unrelated or incomplete work. Refuse unless
    // the index is empty so the commit contains only the paths staged below.
    const stagedOutput = await this.#mustRun(
      "git",
      ["diff", "--cached", "--name-only"],
      worktree,
    );
    const preStaged = stagedOutput.trim();
    if (preStaged.length > 0) {
      throw new Error(
        `Worktree has unexpected staged changes before publish: ${preStaged.replaceAll("\n", ", ")}`,
      );
    }
    await this.#mustRun("git", ["add", "--", ...validated], worktree);
    await this.#mustRun(
      "bunx",
      ["lefthook", "run", "pre-commit"],
      worktree,
      600_000,
    );
    await this.#mustRun("git", ["commit", "-m", message], worktree, 600_000);
    return this.#submitBranch(pr);
  }

  async publishRestack(pr: PrState): Promise<{ headSha: string }> {
    return this.#submitBranch(pr);
  }

  async #submitBranch(pr: PrState): Promise<{ headSha: string }> {
    const worktree = this.#worktree(pr);
    await this.#mustRun(
      "git-spice",
      ["branch", "submit", "--update-only"],
      worktree,
      600_000,
    );
    const head = parseHeadSha(
      await this.#mustRun("gh", [
        "pr",
        "view",
        String(pr.identity.number),
        "--repo",
        this.#repo,
        "--json",
        "headRefOid",
      ]),
    );
    await this.#requestReview(pr.identity.number, head);
    return { headSha: head };
  }

  async #requestReview(prNumber: number, headSha: string): Promise<void> {
    const { owner, name } = splitRepo(this.#repo);
    const marker = `<!-- pr-fleet-review:${headSha} -->`;
    const bodies = await this.#mustRun("gh", [
      "api",
      `repos/${owner}/${name}/issues/${String(prNumber)}/comments`,
      "--paginate",
      "--jq",
      ".[].body",
    ]);
    if (bodies.includes(marker)) {
      return;
    }
    await this.#mustRun("gh", [
      "pr",
      "comment",
      String(prNumber),
      "--repo",
      this.#repo,
      "--body",
      `@codex review\n\n${marker}`,
    ]);
  }

  #worktree(pr: PrState): string {
    if (pr.worktree === null) {
      throw new Error(
        `PR #${String(pr.identity.number)} has no assigned worktree`,
      );
    }
    return pr.worktree;
  }
}
