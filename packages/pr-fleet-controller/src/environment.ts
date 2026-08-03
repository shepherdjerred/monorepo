import {
  reviewGateSkipReasonForAuthor,
  type ReviewProvider,
} from "@shepherdjerred/code-review";
import { resolveReviewState } from "@shepherdjerred/code-review/github";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import { commandEventCorrelation } from "./command-correlation.ts";
import {
  checksWithBuildkiteSoftFailure,
  fingerprint,
  parseBuildkiteBuild,
  parseChecks,
  parsePrList,
  parseReviewPage,
  reviewFindingsFromThreads,
  splitRepo,
  type RawCheck,
  type RawReviewThread,
} from "./evidence-parsers.ts";
import { GitOperations } from "./git-operations.ts";
import type {
  CommandRequest,
  CommandResult,
  FleetEnvironment,
  FleetTelemetry,
} from "./ports.ts";
import { runCommand } from "./process-runner.ts";
import type {
  CheckEvidence,
  PrIdentity,
  PrState,
  ReadinessEvidence,
  ReviewFinding,
} from "./schemas.ts";
import { WorktreeManager } from "./worktree.ts";

export type CommandFleetEnvironmentOptions = {
  repo: string;
  checkout: string;
  worktreeRoot: string;
  provider: ReviewProvider;
  telemetry?: FleetTelemetry;
};

export class CommandFleetEnvironment implements FleetEnvironment {
  readonly #repo: string;
  readonly #checkout: string;
  readonly #provider: ReviewProvider;
  readonly #gitOperations: GitOperations;
  readonly #worktreeManager: WorktreeManager;
  readonly #telemetry: FleetTelemetry | undefined;

  constructor(options: CommandFleetEnvironmentOptions) {
    this.#repo = options.repo;
    this.#checkout = options.checkout;
    this.#provider = options.provider;
    this.#telemetry = options.telemetry;
    const run = (request: CommandRequest) => this.runLocalCommand(request);
    const mustRun = (
      executable: string,
      args: string[],
      cwd?: string,
      commandOptions?: { timeoutMs?: number; signal?: AbortSignal | undefined },
    ) => this.#mustRun(executable, args, cwd, commandOptions);
    this.#gitOperations = new GitOperations({
      repo: options.repo,
      provider: options.provider,
      run,
      mustRun,
    });
    this.#worktreeManager = new WorktreeManager({
      checkout: options.checkout,
      worktreeRoot: options.worktreeRoot,
      run,
      mustRun,
    });
  }

  async runLocalCommand(request: CommandRequest): Promise<CommandResult> {
    const startedAt = performance.now();
    const correlation = commandEventCorrelation(this.#telemetry);
    this.#telemetry?.record(
      "command.started",
      {
        executable: request.executable,
        args: request.args,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        environmentNames: Object.keys(request.env ?? {}).sort(),
      },
      correlation,
    );
    try {
      const result = await runCommand(request);
      this.#telemetry?.record(
        "command.completed",
        {
          executable: request.executable,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: Math.round(performance.now() - startedAt),
        },
        correlation,
      );
      return result;
    } catch (error) {
      this.#telemetry?.record(
        "command.failed",
        {
          executable: request.executable,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        },
        correlation,
      );
      throw error;
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
    const prs = parsePrList(output);
    this.#telemetry?.record("environment.result", {
      operation: "listOpenPrs",
      prs,
    });
    return prs;
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
    // Observe completion FIRST, then fetch review threads — the same order as
    // the canonical gate (scripts/wait-for-review.ts). If a provider finishes
    // between the two calls, pairing a "reviewed" completion with a pre-review
    // (findings-free) thread snapshot would let a green CI run classify the PR
    // green despite newly-created unresolved findings. Fetching threads last
    // keeps the findings snapshot at least as fresh as the completion signal.
    const hostedReviewComplete = await this.#hostedReviewComplete(pr);
    const threads = await this.#reviewThreads(pr);
    const findings = reviewFindingsFromThreads(threads, this.#provider);
    return { findings, hostedReviewComplete };
  }

  async #hostedReviewComplete(pr: PrIdentity): Promise<boolean> {
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
      return true;
    }

    // Completion is resolved with the canonical provider strategy: a
    // review-at-head OR a head-bound 👍 clean-review reaction. Codex leaves NO
    // review object on a clean PR — only a 👍 — so keying completion off review
    // objects alone would leave every cleanly-reviewed PR pending forever.
    // Binding the commit-less reaction to the current head requires the
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
    return reviewState.state === "reviewed";
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
    rawChecks: RawCheck[],
  ): Promise<{
    checks: CheckEvidence[];
    buildkiteCurrentHead: boolean;
    buildkiteFailure: ReadinessEvidence["buildkiteFailure"];
  }> {
    const buildkite = rawChecks.find(
      (check) => check.link?.includes("buildkite.com/") === true,
    );
    if (buildkite?.link === null || buildkite?.link === undefined) {
      // No Buildkite build to correlate against: nothing is soft-failed and
      // there is no current-head Buildkite evidence.
      return {
        checks: checksWithBuildkiteSoftFailure(rawChecks, []),
        buildkiteCurrentHead: false,
        buildkiteFailure: null,
      };
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
      return {
        checks: checksWithBuildkiteSoftFailure(rawChecks, []),
        buildkiteCurrentHead: false,
        buildkiteFailure: null,
      };
    }
    // Fetch the FULL build (every job) so each check's soft-failure status can
    // be derived from the authoritative per-job `soft_failed` metadata rather
    // than a check-name heuristic.
    const result = await this.runLocalCommand({
      executable: "bk",
      args: [
        "build",
        "view",
        buildNumber,
        "--pipeline",
        `${organization}/${pipeline}`,
        "--json",
        "--no-input",
      ],
      cwd: this.#checkout,
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Buildkite inspection failed: ${result.stderr.trim()}`);
    }
    const build = parseBuildkiteBuild(result.stdout);
    const checks = checksWithBuildkiteSoftFailure(rawChecks, build.jobs);
    if (build.commit !== pr.headSha) {
      return { checks, buildkiteCurrentHead: false, buildkiteFailure: null };
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
      return { checks, buildkiteCurrentHead: true, buildkiteFailure: null };
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
      checks,
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
    const [rawChecks, reviews, conflict] = await Promise.all([
      this.#checks(pr),
      this.#reviews(pr),
      this.#conflict(pr),
    ]);
    // Resolve each check's soft-failure status against the Buildkite build's
    // per-job metadata BEFORE computing hard failures, so a soft Semgrep/Trivy
    // finding is not counted as blocking and a hard scanner failure is not
    // ignored.
    const { checks, buildkiteCurrentHead, buildkiteFailure } =
      await this.#buildkiteEvidence(pr, rawChecks);
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

    const evidence: ReadinessEvidence = {
      headSha: pr.headSha,
      checks,
      buildkiteCurrentHead,
      buildkiteFailure,
      conflict,
      reviewFindings: reviews.findings,
      hostedReviewComplete: reviews.hostedReviewComplete,
      hardFailureFingerprint: fingerprint(hardFailures),
      reviewFingerprint: fingerprint(blockingReviews),
    };
    this.#telemetry?.record(
      "environment.result",
      { operation: "refreshEvidence", evidence },
      { prNumber: pr.number, headSha: pr.headSha },
    );
    return evidence;
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
