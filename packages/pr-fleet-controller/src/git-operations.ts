import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ReviewProvider } from "@shepherdjerred/code-review";
import { z } from "zod";
import { isTelemetryCaptureError } from "./controller-telemetry.ts";
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

const SystemErrorSchema = z.object({ code: z.string() });

function isMissingPath(error: unknown): boolean {
  const parsed = SystemErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === "ENOENT";
}

async function nearestExistingAncestor(target: string): Promise<string> {
  try {
    await stat(target);
    return target;
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error instanceof Error
        ? error
        : new Error("Failed to inspect publication path", { cause: error });
    }
    const parent = path.dirname(target);
    if (parent === target) {
      throw new Error(`No existing ancestor for publication path: ${target}`, {
        cause: error,
      });
    }
    return nearestExistingAncestor(parent);
  }
}

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
        requestedPath.split("/").includes("..") ||
        requestedPath.split("/").includes(".git")
      ) {
        throw new Error(`Unsafe publication path: ${requestedPath}`);
      }
      const absolute = path.resolve(canonicalRoot, requestedPath);
      // A deletion may remove its whole parent directory. Resolve the nearest
      // ancestor that still exists, which supports that legitimate pathspec
      // while still detecting a surviving symlink that escapes the worktree.
      const existingAncestor = await nearestExistingAncestor(
        path.dirname(absolute),
      );
      const canonicalAncestor = await realpath(existingAncestor);
      const relativeAncestor = path.relative(canonicalRoot, canonicalAncestor);
      if (
        relativeAncestor.startsWith("..") ||
        path.isAbsolute(relativeAncestor)
      ) {
        throw new Error(`Publication path escapes worktree: ${requestedPath}`);
      }
      // Reject directory pathspecs. `git add -- .` or a package directory would
      // recursively stage unrelated validation outputs or prior edits despite
      // the explicit-path publication boundary. Each entry must name one
      // specific file: an existing regular file, or a path that no longer exists
      // (an explicit deletion). A path resolving to an existing directory — or
      // any other non-regular-file — is rejected.
      const stats = await stat(absolute).catch((error: unknown) => {
        if (isMissingPath(error)) {
          // Missing path: an explicit file deletion is a valid publication entry.
          return null;
        }
        throw error;
      });
      if (stats !== null && !stats.isFile()) {
        throw new Error(
          `Publication path is not a specific file: ${requestedPath}`,
        );
      }
      validated.push(requestedPath);
    }
    return validated;
  }

  // Determine which same-repository stack tool owns a PR's branch so restacks
  // and submissions are routed through it (never blindly through git-spice).
  // Fork (cross-repository) PRs are rejected earlier by the callers, so this only
  // distinguishes git-spice from native/unstacked branches:
  //
  // - git-spice records every tracked branch as a file `branches/<name>` in its
  //   `refs/spice/data` state ref; a present entry means git-spice owns it.
  // - Otherwise the branch belongs to GitHub's native stack tooling (or is an
  //   unstacked single PR), which git-spice must not be run against.
  async #stackOwner(
    pr: PrState,
    worktree: string,
    signal?: AbortSignal,
  ): Promise<"git-spice" | "native"> {
    const tracked = await this.#run({
      executable: "git",
      args: [
        "cat-file",
        "-e",
        `refs/spice/data:branches/${pr.identity.headRefName}`,
      ],
      cwd: worktree,
      timeoutMs: 30_000,
      signal,
    });
    return tracked.exitCode === 0 ? "git-spice" : "native";
  }

  async startRestack(
    pr: PrState,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    const worktree = this.#worktree(pr);
    const owner = await this.#stackOwner(pr, worktree, signal);
    if (owner === "native") {
      const remoteBase = `refs/remotes/origin/${pr.identity.baseRefName}`;
      await this.#mustRun(
        "git",
        [
          "fetch",
          "origin",
          `+refs/heads/${pr.identity.baseRefName}:${remoteBase}`,
        ],
        worktree,
        { timeoutMs: 120_000, signal },
      );
      return this.#run({
        executable: "git",
        args: ["rebase", remoteBase],
        cwd: worktree,
        timeoutMs: 600_000,
        signal,
      });
    }
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
    const owner = await this.#stackOwner(pr, worktree, signal);
    return this.#run({
      executable: owner === "git-spice" ? "git-spice" : "git",
      args:
        owner === "git-spice"
          ? ["--no-prompt", "rebase", "continue"]
          : ["-c", "core.editor=true", "rebase", "--continue"],
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
      if (isTelemetryCaptureError(error)) {
        throw error;
      }
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
    if (pr.identity.crossRepository) {
      // Fork PRs are never provisioned a worktree (`provisionWorktree` throws for
      // cross-repository PRs), so this path is unreachable-by-construction. Fail
      // fast rather than push to `origin` — which is the BASE repository here, not
      // the contributor's fork — and silently create/overwrite a base-repo branch
      // that does not update the PR head.
      throw new Error(
        `Cannot publish PR #${String(pr.identity.number)}: cross-repository (fork) PRs are not supported by the controller`,
      );
    }
    const owner = await this.#stackOwner(pr, worktree, signal);
    if (owner === "git-spice") {
      await this.#mustRun(
        "git-spice",
        ["branch", "submit", "--update-only"],
        worktree,
        { timeoutMs: 600_000, signal },
      );
    } else {
      // Native gh-stack or unstacked single PR: the PR already exists (the
      // controller never opens PRs), so publish the repaired head by
      // force-pushing the branch to its existing remote head. This is the
      // plain-gh publication path; it is safe for a gh-stack branch because
      // updating a branch's commits does not change the stack's parent
      // relationships (only re-parenting would, which the controller never does).
      await this.#mustRun(
        "git",
        [
          "push",
          "--force-with-lease",
          "origin",
          `HEAD:refs/heads/${pr.identity.headRefName}`,
        ],
        worktree,
        { timeoutMs: 600_000, signal },
      );
    }
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
