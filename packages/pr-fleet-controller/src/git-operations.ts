import { realpath } from "node:fs/promises";
import path from "node:path";
import type { ReviewProvider } from "@shepherdjerred/code-review";
import { parseHeadSha, splitRepo } from "./evidence-parsers.ts";
import type { CommandRequest, CommandResult } from "./ports.ts";
import type { PrState } from "./schemas.ts";

type GitOperationsDependencies = {
  repo: string;
  provider: ReviewProvider;
  run: (request: CommandRequest) => Promise<CommandResult>;
  mustRun: (
    executable: string,
    args: string[],
    cwd?: string,
    options?: { timeoutMs?: number; signal?: AbortSignal | undefined },
  ) => Promise<string>;
};

export class GitOperations {
  readonly #repo: string;
  readonly #provider: ReviewProvider;
  readonly #run: GitOperationsDependencies["run"];
  readonly #mustRun: GitOperationsDependencies["mustRun"];

  constructor(dependencies: GitOperationsDependencies) {
    this.#repo = dependencies.repo;
    this.#provider = dependencies.provider;
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

  async startRestack(
    pr: PrState,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
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
      signal,
    });
  }

  async continueRestack(
    pr: PrState,
    paths: string[],
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    const worktree = this.#worktree(pr);
    const validated = await this.#validatePaths(worktree, paths);
    if (validated.length === 0) {
      throw new Error("continueRestack requires explicit resolved paths");
    }
    await this.#mustRun("git", ["add", "--", ...validated], worktree, {
      signal,
    });
    return this.#run({
      executable: "git-spice",
      args: ["--no-prompt", "rebase", "continue"],
      cwd: worktree,
      timeoutMs: 600_000,
      signal,
    });
  }

  async publishFix(
    pr: PrState,
    paths: string[],
    message: string,
    signal?: AbortSignal,
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
      { signal },
    );
    const preStaged = stagedOutput.trim();
    if (preStaged.length > 0) {
      throw new Error(
        `Worktree has unexpected staged changes before publish: ${preStaged.replaceAll("\n", ", ")}`,
      );
    }
    await this.#mustRun("git", ["add", "--", ...validated], worktree, {
      signal,
    });
    try {
      await this.#mustRun("bunx", ["lefthook", "run", "pre-commit"], worktree, {
        timeoutMs: 600_000,
        signal,
      });
      await this.#mustRun("git", ["commit", "-m", message], worktree, {
        timeoutMs: 600_000,
        signal,
      });
    } catch (error) {
      // Pre-commit (or the commit itself) failed after staging the validated
      // paths. Leaving them staged would trip the "unexpected staged changes"
      // guard above on every retry, and the worker has no unstage tool — a
      // fixable formatting/lockfile/secret-scan failure would permanently wedge
      // publication. Restore the previously-empty index before rethrowing so a
      // retry starts clean. (`git reset -- <paths>` only unstages; the working
      // tree edits are preserved for the retry.)
      await this.#mustRun("git", ["reset", "--", ...validated], worktree);
      throw error;
    }
    return this.#submitBranch(pr, signal);
  }

  async publishRestack(
    pr: PrState,
    signal?: AbortSignal,
  ): Promise<{ headSha: string }> {
    return this.#submitBranch(pr, signal);
  }

  async #submitBranch(
    pr: PrState,
    signal?: AbortSignal,
  ): Promise<{ headSha: string }> {
    const worktree = this.#worktree(pr);
    await this.#mustRun(
      "git-spice",
      ["branch", "submit", "--update-only"],
      worktree,
      { timeoutMs: 600_000, signal },
    );
    const head = parseHeadSha(
      await this.#mustRun(
        "gh",
        [
          "pr",
          "view",
          String(pr.identity.number),
          "--repo",
          this.#repo,
          "--json",
          "headRefOid",
        ],
        undefined,
        { signal },
      ),
    );
    await this.#requestReview(pr.identity.number, head, signal);
    return { headSha: head };
  }

  async #requestReview(
    prNumber: number,
    headSha: string,
    signal?: AbortSignal,
  ): Promise<void> {
    // Only the configured hosted-review provider is asked to re-review, and
    // only if it has a manual trigger. Providers that review automatically
    // (`requestReview === null`) get no comment, and no provider other than the
    // selected one is ever mentioned.
    const strategy = this.#provider.requestReview;
    if (strategy === null) {
      return;
    }
    const { owner, name } = splitRepo(this.#repo);
    const marker = `<!-- pr-fleet-review:${this.#provider.id}:${headSha} -->`;
    const bodies = await this.#mustRun(
      "gh",
      [
        "api",
        `repos/${owner}/${name}/issues/${String(prNumber)}/comments`,
        "--paginate",
        "--jq",
        ".[].body",
      ],
      undefined,
      { signal },
    );
    if (bodies.includes(marker)) {
      return;
    }
    await this.#mustRun(
      "gh",
      [
        "pr",
        "comment",
        String(prNumber),
        "--repo",
        this.#repo,
        "--body",
        strategy.buildComment(marker),
      ],
      undefined,
      { signal },
    );
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
