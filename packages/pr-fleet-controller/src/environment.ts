import {
  reviewGateSkipReasonForAuthor,
  type ReviewProvider,
} from "@shepherdjerred/code-review";
import { resolveReviewState } from "@shepherdjerred/code-review/github";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import {
  fingerprint,
  parseBuildkiteBuild,
  parseBuildkiteCommit,
  parseChecks,
  parsePrList,
  parseReviewPage,
  reviewFindingsFromThreads,
  splitRepo,
  type RawReviewThread,
} from "./evidence-parsers.ts";
import { GitOperations } from "./git-operations.ts";
import type {
  CommandRequest,
  CommandResult,
  FleetEnvironment,
} from "./ports.ts";
import type {
  PrIdentity,
  PrState,
  ReadinessEvidence,
  ReviewFinding,
} from "./schemas.ts";
import { WorktreeManager } from "./worktree.ts";

export class CommandFleetEnvironment implements FleetEnvironment {
  readonly #repo: string;
  readonly #checkout: string;
  readonly #provider: ReviewProvider;
  readonly #gitOperations: GitOperations;
  readonly #worktreeManager: WorktreeManager;

  constructor(
    repo: string,
    checkout: string,
    worktreeRoot: string,
    provider: ReviewProvider,
  ) {
    this.#repo = repo;
    this.#checkout = checkout;
    this.#provider = provider;
    const run = (request: CommandRequest) => this.runLocalCommand(request);
    const mustRun = (
      executable: string,
      args: string[],
      cwd?: string,
      options?: { timeoutMs?: number; signal?: AbortSignal | undefined },
    ) => this.#mustRun(executable, args, cwd, options);
    this.#gitOperations = new GitOperations({ repo, provider, run, mustRun });
    this.#worktreeManager = new WorktreeManager({
      checkout,
      worktreeRoot,
      run,
      mustRun,
    });
  }

  async runLocalCommand(request: CommandRequest): Promise<CommandResult> {
    const baseOptions = {
      cwd: request.cwd,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
      env: request.env ?? Bun.env,
    };
    const subprocess =
      request.signal === undefined
        ? Bun.spawn([request.executable, ...request.args], baseOptions)
        : Bun.spawn([request.executable, ...request.args], {
            ...baseOptions,
            signal: request.signal,
          });
    const timer = setTimeout(() => {
      subprocess.kill();
    }, request.timeoutMs);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  }

  async #mustRun(
    executable: string,
    args: string[],
    cwd = this.#checkout,
    options: { timeoutMs?: number; signal?: AbortSignal | undefined } = {},
  ): Promise<string> {
    const result = await this.runLocalCommand({
      executable,
      args,
      cwd,
      timeoutMs: options.timeoutMs ?? 120_000,
      signal: options.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `${executable} ${args.join(" ")} failed (${String(result.exitCode)}): ${result.stderr.trim()}`,
      );
    }
    return result.stdout;
  }

  async listOpenPrs(): Promise<PrIdentity[]> {
    const output = await this.#mustRun("gh", [
      "pr",
      "list",
      "--repo",
      this.#repo,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,url,isDraft,author,labels,headRefName,headRefOid,baseRefName,isCrossRepository,maintainerCanModify",
    ]);
    return parsePrList(output);
  }

  async #checks(pr: PrIdentity) {
    const result = await this.runLocalCommand({
      executable: "gh",
      args: [
        "pr",
        "checks",
        String(pr.number),
        "--repo",
        this.#repo,
        "--json",
        "name,state,bucket,link",
      ],
      cwd: this.#checkout,
      timeoutMs: 120_000,
    });
    if (![0, 1, 8].includes(result.exitCode)) {
      throw new Error(`gh pr checks failed: ${result.stderr.trim()}`);
    }
    return parseChecks(result.stdout);
  }

  async #reviewThreads(pr: PrIdentity): Promise<RawReviewThread[]> {
    const { owner, name } = splitRepo(this.#repo);
    const threads: RawReviewThread[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){
      repository(owner:$owner,name:$name){
        pullRequest(number:$number){
          reviewThreads(first:100,after:$cursor){
            pageInfo{hasNextPage endCursor}
            nodes{id isResolved isOutdated comments(first:1){nodes{body author{login}}}}
          }
        }
      }
    }`;

    while (hasNextPage) {
      const args = [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `number=${String(pr.number)}`,
      ];
      if (cursor !== null) {
        args.push("-f", `cursor=${cursor}`);
      }
      const page = parseReviewPage(await this.#mustRun("gh", args));
      for (const thread of page.reviewThreads.nodes) {
        const comment = thread.comments.nodes[0];
        threads.push({
          id: thread.id,
          author: comment?.author?.login ?? "unknown",
          body: comment?.body ?? "",
          resolved: thread.isResolved,
          outdated: thread.isOutdated,
        });
      }
      hasNextPage = page.reviewThreads.pageInfo.hasNextPage;
      cursor = page.reviewThreads.pageInfo.endCursor;
      if (hasNextPage && cursor === null) {
        throw new Error(
          `PR #${String(pr.number)} review pagination lost its cursor`,
        );
      }
    }
    return threads;
  }

  async #reviews(pr: PrIdentity): Promise<{
    findings: ReviewFinding[];
    hostedReviewComplete: boolean;
  }> {
    const threads = await this.#reviewThreads(pr);
    const findings = reviewFindingsFromThreads(threads, this.#provider);

    // Honor the provider's bot-author skip policy, exactly as the canonical
    // Buildkite gate does. A provider like Codex declares
    // botAuthoredPullRequestPolicy: "skip" and emits NO completion signal for
    // bot-authored PRs (Renovate, release automation), so resolving review
    // state would leave those PRs pending forever. When the skip applies, treat
    // hosted review as complete.
    if (
      reviewGateSkipReasonForAuthor({
        author: { login: pr.author, type: pr.authorType },
        provider: this.#provider,
      }) !== null
    ) {
      return { findings, hostedReviewComplete: true };
    }

    // Completion is resolved with the canonical provider strategy: a
    // review-at-head OR a head-bound 👍 clean-review reaction. Codex leaves NO
    // review object on a clean PR — only a 👍 — so keying `hostedReviewComplete`
    // off review objects alone would leave every cleanly-reviewed PR pending
    // forever. Binding the commit-less reaction to the current head requires the
    // head-push time.
    const tokenOutput = await this.#mustRun("gh", ["auth", "token"]);
    const token = tokenOutput.trim();
    const headPushedAt = await fetchHeadPushedAt({
      repo: this.#repo,
      sha: pr.headSha,
      prNumber: pr.number,
      token,
    });
    const reviewState = await resolveReviewState({
      provider: this.#provider,
      repo: this.#repo,
      head: pr.headSha,
      prNumber: pr.number,
      token,
      headPushedAt,
    });
    return { findings, hostedReviewComplete: reviewState.state === "reviewed" };
  }

  async #conflict(pr: PrIdentity): Promise<boolean> {
    await this.#mustRun("git", [
      "fetch",
      "origin",
      `refs/heads/${pr.baseRefName}:refs/remotes/origin/${pr.baseRefName}`,
    ]);
    await this.#mustRun("git", [
      "fetch",
      "origin",
      `pull/${String(pr.number)}/head:refs/remotes/pull/${String(pr.number)}/head`,
    ]);
    const fetchedHeadOutput = await this.#mustRun("git", [
      "rev-parse",
      `refs/remotes/pull/${String(pr.number)}/head`,
    ]);
    const fetchedHead = fetchedHeadOutput.trim();
    if (fetchedHead !== pr.headSha) {
      throw new Error(
        `PR #${String(pr.number)} changed during conflict inspection (${pr.headSha} -> ${fetchedHead})`,
      );
    }
    const result = await this.runLocalCommand({
      executable: "git",
      args: [
        "merge-tree",
        "--write-tree",
        "--quiet",
        `refs/remotes/origin/${pr.baseRefName}`,
        `refs/remotes/pull/${String(pr.number)}/head`,
      ],
      cwd: this.#checkout,
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        `merge-tree failed for PR #${String(pr.number)}: ${result.stderr.trim()}`,
      );
    }
    return result.exitCode === 1;
  }

  async #buildkiteEvidence(
    pr: PrIdentity,
    checks: ReadinessEvidence["checks"],
  ): Promise<
    Pick<ReadinessEvidence, "buildkiteCurrentHead" | "buildkiteFailure">
  > {
    const buildkite = checks.find(
      (check) => check.link?.includes("buildkite.com/") === true,
    );
    if (buildkite?.link === null || buildkite?.link === undefined) {
      return { buildkiteCurrentHead: false, buildkiteFailure: null };
    }
    const url = new URL(buildkite.link);
    const parts = url.pathname.split("/").filter((part) => part.length > 0);
    const buildsIndex = parts.indexOf("builds");
    const organization = parts[0];
    const pipeline = parts[1];
    const buildNumber = parts[buildsIndex + 1];
    if (
      buildsIndex === -1 ||
      organization === undefined ||
      pipeline === undefined ||
      buildNumber === undefined
    ) {
      return { buildkiteCurrentHead: false, buildkiteFailure: null };
    }
    const hardFailure = checks.some(
      (check) =>
        !check.softFail &&
        (check.bucket.toLowerCase() === "fail" ||
          check.state.toLowerCase() === "failure"),
    );
    const args = [
      "build",
      "view",
      buildNumber,
      "--pipeline",
      `${organization}/${pipeline}`,
    ];
    if (hardFailure) {
      args.push("--job-states", "failed,broken");
    } else {
      args.push("--summary");
    }
    args.push("--json", "--no-input");
    const result = await this.runLocalCommand({
      executable: "bk",
      args,
      cwd: this.#checkout,
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Buildkite inspection failed: ${result.stderr.trim()}`);
    }
    if (!hardFailure) {
      return {
        buildkiteCurrentHead:
          parseBuildkiteCommit(result.stdout) === pr.headSha,
        buildkiteFailure: null,
      };
    }
    const build = parseBuildkiteBuild(result.stdout);
    if (build.commit !== pr.headSha) {
      return { buildkiteCurrentHead: false, buildkiteFailure: null };
    }
    const failedJobs = build.jobs
      .filter(
        (job) =>
          job.soft_failed !== true &&
          (job.state === "failed" || job.state === "broken"),
      )
      .sort((left, right) => {
        if (left.state !== right.state) {
          return left.state === "failed" ? -1 : 1;
        }
        return (left.started_at ?? "").localeCompare(right.started_at ?? "");
      });
    const earliest = failedJobs[0];
    if (earliest === undefined) {
      return { buildkiteCurrentHead: true, buildkiteFailure: null };
    }
    const log = await this.#mustRun("bk", [
      "job",
      "log",
      earliest.id,
      "--agent",
      "--format",
      "markdown",
      "--max-tokens",
      "6000",
      "--no-input",
    ]);
    return {
      buildkiteCurrentHead: true,
      buildkiteFailure: {
        jobId: earliest.id,
        name: earliest.name,
        state: earliest.state,
        webUrl: earliest.web_url,
        startedAt: earliest.started_at ?? null,
        log,
      },
    };
  }

  async refreshEvidence(pr: PrIdentity): Promise<ReadinessEvidence> {
    const [checks, reviews, conflict] = await Promise.all([
      this.#checks(pr),
      this.#reviews(pr),
      this.#conflict(pr),
    ]);
    const hardFailures = checks
      .filter(
        (check) =>
          !check.softFail &&
          (check.bucket.toLowerCase() === "fail" ||
            check.state.toLowerCase() === "failure"),
      )
      .map((check) => check.name);
    const blockingReviews = reviews.findings
      .filter((finding) => !finding.resolved && !finding.outdated)
      .map((finding) => `${finding.severity}:${finding.body}`);

    const buildkiteEvidence = await this.#buildkiteEvidence(pr, checks);
    return {
      headSha: pr.headSha,
      checks,
      ...buildkiteEvidence,
      conflict,
      reviewFindings: reviews.findings,
      hostedReviewComplete: reviews.hostedReviewComplete,
      hardFailureFingerprint: fingerprint(hardFailures),
      reviewFingerprint: fingerprint(blockingReviews),
    };
  }

  findWorktree(branches: string[]): Promise<string | null> {
    return this.#worktreeManager.findWorktree(branches);
  }

  assignWorktreeBranch(worktree: string, pr: PrIdentity): Promise<void> {
    return this.#worktreeManager.assignWorktreeBranch(worktree, pr);
  }

  provisionWorktree(pr: PrIdentity, stackId: string): Promise<string> {
    return this.#worktreeManager.provisionWorktree(pr, stackId);
  }

  startRestack(pr: PrState, signal?: AbortSignal): Promise<CommandResult> {
    return this.#gitOperations.startRestack(pr, signal);
  }

  continueRestack(
    pr: PrState,
    paths: string[],
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    return this.#gitOperations.continueRestack(pr, paths, signal);
  }

  publishFix(
    pr: PrState,
    paths: string[],
    message: string,
    signal?: AbortSignal,
  ): Promise<{ headSha: string }> {
    return this.#gitOperations.publishFix(pr, paths, message, signal);
  }

  publishRestack(
    pr: PrState,
    signal?: AbortSignal,
  ): Promise<{ headSha: string }> {
    return this.#gitOperations.publishRestack(pr, signal);
  }
}
