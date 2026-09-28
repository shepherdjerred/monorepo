import type { ReviewProvider } from "@shepherdjerred/code-review";
import {
  checksAsEvidence,
  fingerprint,
  parseCiPipeline,
  parseChecks,
  parsePrList,
  parseReviewPage,
  reviewFindings,
  splitRepo,
  type RawCheck,
  type RawReviewThread,
} from "#domain/evidence-parsers.ts";
import { GitOperations } from "./git-operations.ts";
import { captureTelemetryOperation } from "#runtime/telemetry.ts";
import { currentCommandCorrelation } from "#runtime/command-correlation.ts";
import { resolveHostedReviewCompletion } from "./hosted-review.ts";
import { recordEvidenceRefresh, settleEvidenceParts } from "./refresh.ts";
import type {
  CommandRequest,
  CommandResult,
  FleetEnvironment,
  FleetTelemetry,
} from "#domain/ports.ts";
import { runRecordedCommand } from "#exec/recorded-command.ts";
import type {
  CheckEvidence,
  PrIdentity,
  PrState,
  ReadinessEvidence,
  ReviewFinding,
  WorktreeContext,
} from "#domain/schemas.ts";
import { WorktreeManager } from "./worktree.ts";
import { PrHeadChangedDuringRefreshError } from "#domain/errors.ts";

/** Repository slug the Woodpecker CLI addresses. */
const MONOREPO = "shepherdjerred/monorepo";

export type CommandFleetEnvironmentOptions = {
  repo: string;
  checkout: string;
  worktreeRoot: string;
  provider: ReviewProvider;
  telemetry?: FleetTelemetry;
  author?: string | null;
};

export class CommandFleetEnvironment implements FleetEnvironment {
  readonly #repo: string;
  readonly #checkout: string;
  readonly #provider: ReviewProvider;
  readonly #author: string | null;
  readonly #gitOperations: GitOperations;
  readonly #worktreeManager: WorktreeManager;
  readonly #telemetry: FleetTelemetry | undefined;

  constructor(options: CommandFleetEnvironmentOptions) {
    this.#repo = options.repo;
    this.#checkout = options.checkout;
    this.#provider = options.provider;
    this.#author = options.author ?? null;
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
      telemetry: options.telemetry,
    });
    this.#worktreeManager = new WorktreeManager({
      checkout: options.checkout,
      worktreeRoot: options.worktreeRoot,
      run,
      mustRun,
    });
  }

  // The reconcile fan-out refreshes evidence for up to five PRs concurrently
  // (`mapBounded(identities, 5, …)`), and each PR's `#conflict()` runs a
  // sequence of git commands against the single checkout's shared ref store.
  // Git cannot tolerate ANY concurrent ref access there: two `git fetch`
  // invocations race on the ref-lock / packed-refs transaction, and even a
  // read (`git rev-parse`) can miss a loose ref while another PR's fetch is
  // consolidating loose refs into `packed-refs`. Either way a ref reads back
  // missing and the tick aborts. Every PR's whole git critical section is
  // therefore run atomically through this promise-mutex, while the network
  // evidence calls (`gh`, `bk`) stay fully parallel across the fan-out.
  #gitQueue: Promise<unknown> = Promise.resolve();

  #withGitLock<T>(operation: () => Promise<T>): Promise<T> {
    const priorTail = this.#gitQueue;
    const result = (async (): Promise<T> => {
      // Await the tail regardless of whether the prior section fulfilled or
      // rejected, so one failed section cannot wedge the queue for later
      // waiters; its rejection was already surfaced to its own caller.
      try {
        await priorTail;
      } catch {
        // Prior section already reported this to its caller.
      }
      return operation();
    })();
    // Advance the queue only after this section settles, swallowing its outcome
    // so the next waiter is not affected by a rejection here.
    this.#gitQueue = (async (): Promise<void> => {
      try {
        await result;
      } catch {
        // Surfaced to this section's caller via the returned promise.
      }
    })();
    return result;
  }

  async runLocalCommand(request: CommandRequest): Promise<CommandResult> {
    return runRecordedCommand(request, this.#telemetry);
  }

  async #mustRun(
    executable: string,
    args: string[],
    cwd = this.#checkout,
    options: {
      timeoutMs?: number;
      signal?: AbortSignal | undefined;
      sensitiveOutput?: boolean | undefined;
    } = {},
  ): Promise<string> {
    const result = await this.runLocalCommand({
      executable,
      args,
      cwd,
      timeoutMs: options.timeoutMs ?? 120_000,
      signal: options.signal,
      sensitiveOutput: options.sensitiveOutput,
    });
    if (result.exitCode !== 0) {
      const detail =
        options.sensitiveOutput === true
          ? "sensitive output omitted"
          : result.stderr.trim() ||
            result.stdout.trim() ||
            "no diagnostic output";
      throw new Error(
        `${executable} ${args.join(" ")} failed (${String(result.exitCode)}): ${detail}`,
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
      ...(this.#author === null ? [] : ["--author", this.#author]),
    ]);
    const prs = parsePrList(output);
    captureTelemetryOperation("environment.result", () => {
      this.#telemetry?.record(
        "environment.result",
        {
          operation: "listOpenPrs",
          prs,
        },
        currentCommandCorrelation(),
      );
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
    // the canonical gate (scripts/review/wait-for-review.ts). If a provider finishes
    // between the two calls, pairing a "reviewed" completion with a pre-review
    // (findings-free) thread snapshot would let a green CI run classify the PR
    // green despite newly-created unresolved findings. Fetching threads last
    // keeps the findings snapshot at least as fresh as the completion signal.
    const completion = await resolveHostedReviewCompletion({
      repo: this.#repo,
      provider: this.#provider,
      pr,
      readToken: () =>
        this.#mustRun("gh", ["auth", "token"], this.#checkout, {
          sensitiveOutput: true,
        }),
    });
    const threads = await this.#reviewThreads(pr);
    // Until the provider acknowledges this head, its comment still renders the
    // PREVIOUS head's findings — the snapshot completion itself refuses. Since
    // `classify()` reads findings before `hostedReviewComplete`, surfacing them
    // would dispatch a repair against findings the push already fixed.
    const { complete } = completion;
    const issueComment = complete ? completion.issueComment : null;
    const provider = this.#provider;
    const findings = reviewFindings({ threads, issueComment, provider });
    return { findings, hostedReviewComplete: complete };
  }

  async #conflict(pr: PrIdentity): Promise<boolean> {
    // Run the whole fetch → rev-parse → merge-tree sequence as one critical
    // section so no other PR's git ref access overlaps it (see #withGitLock).
    return this.#withGitLock(async () => {
      await this.#mustRun("git", [
        "fetch",
        "origin",
        `refs/heads/${pr.baseRefName}:refs/remotes/origin/${pr.baseRefName}`,
      ]);
      await this.#mustRun("git", [
        "fetch",
        "origin",
        // The source MUST be fully qualified (`refs/pull/N/head`). With the
        // unqualified `pull/N/head`, once `refs/remotes/pull/N/head` exists its
        // abbreviated name is also `pull/N/head`, so git resolves the source to
        // that local ref, finds no matching remote ref, and prunes the
        // destination ("- [deleted] (none)") while still exiting 0 — the next
        // `rev-parse` then fails and the whole tick aborts.
        `+refs/pull/${String(pr.number)}/head:refs/remotes/pull/${String(pr.number)}/head`,
      ]);
      const fetchedHeadOutput = await this.#mustRun("git", [
        "rev-parse",
        `refs/remotes/pull/${String(pr.number)}/head`,
      ]);
      const fetchedHead = fetchedHeadOutput.trim();
      if (fetchedHead !== pr.headSha) {
        throw new PrHeadChangedDuringRefreshError(
          pr.number,
          pr.headSha,
          fetchedHead,
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
    });
  }

  /**
   * Correlate GitHub's checks with the authoritative Woodpecker pipeline.
   *
   * GitHub's check summary can lag or describe a different head, so the
   * pipeline is fetched and its commit compared before any of its evidence is
   * trusted for this PR.
   */
  async #ciEvidence(
    pr: PrIdentity,
    rawChecks: RawCheck[],
  ): Promise<{
    checks: CheckEvidence[];
    ciCurrentHead: boolean;
    ciFailure: ReadinessEvidence["ciFailure"];
  }> {
    const checks = checksAsEvidence(rawChecks);
    const ciCheck = rawChecks.find(
      (check) => check.link?.includes("/pipeline/") === true,
    );
    if (ciCheck?.link === null || ciCheck?.link === undefined) {
      return { checks, ciCurrentHead: false, ciFailure: null };
    }

    const match = /\/pipeline\/(?<number>\d+)/u.exec(
      new URL(ciCheck.link).pathname,
    );
    const pipelineNumber = match?.groups?.["number"];
    if (pipelineNumber === undefined) {
      return { checks, ciCurrentHead: false, ciFailure: null };
    }

    const result = await this.runLocalCommand({
      executable: "woodpecker-cli",
      args: ["pipeline", "show", MONOREPO, pipelineNumber, "--output", "json"],
      cwd: this.#checkout,
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Woodpecker inspection failed: ${result.stderr.trim()}`);
    }

    const pipeline = parseCiPipeline(result.stdout);
    if (pipeline.commit !== pr.headSha) {
      return { checks, ciCurrentHead: false, ciFailure: null };
    }

    // Earliest failure first: it is the most likely cause, and later ones are
    // often knock-on effects of it.
    const failed = pipeline.workflows
      .filter((workflow) =>
        ["failure", "error", "killed"].includes(workflow.state.toLowerCase()),
      )
      .sort((left, right) => (left.started ?? 0) - (right.started ?? 0));
    const earliest = failed[0];
    if (earliest === undefined) {
      return { checks, ciCurrentHead: true, ciFailure: null };
    }

    const log = await this.#mustRun("woodpecker-cli", [
      "logs",
      MONOREPO,
      pipelineNumber,
      earliest.name,
    ]);
    return {
      checks,
      ciCurrentHead: true,
      ciFailure: {
        pipelineNumber: pipeline.number,
        name: earliest.name,
        state: earliest.state,
        webUrl: ciCheck.link,
        startedAt:
          earliest.started === undefined
            ? null
            : new Date(earliest.started * 1000).toISOString(),
        log,
      },
    };
  }

  async refreshEvidence(pr: PrIdentity): Promise<ReadinessEvidence> {
    return recordEvidenceRefresh(this.#telemetry, pr, () =>
      this.#collectEvidence(pr),
    );
  }

  async #collectEvidence(pr: PrIdentity): Promise<ReadinessEvidence> {
    const [rawChecks, reviews, conflict] = await settleEvidenceParts(
      this.#checks(pr),
      this.#reviews(pr),
      this.#conflict(pr),
    );
    const { checks, ciCurrentHead, ciFailure } = await this.#ciEvidence(
      pr,
      rawChecks,
    );
    // No soft-failure exclusion any more: the advisory lanes exit 0 when their
    // findings are not fatal, so a failed check is a real failure.
    const hardFailures = checks
      .filter(
        (check) =>
          check.bucket.toLowerCase() === "fail" ||
          check.state.toLowerCase() === "failure",
      )
      .map((check) => check.name);
    const blockingReviews = reviews.findings
      .filter((finding) => !finding.resolved && !finding.outdated)
      .map((finding) => `${finding.severity}:${finding.body}`);

    const evidence: ReadinessEvidence = {
      headSha: pr.headSha,
      checks,
      ciCurrentHead,
      ciFailure,
      conflict,
      reviewFindings: reviews.findings,
      hostedReviewComplete: reviews.hostedReviewComplete,
      hardFailureFingerprint: fingerprint(hardFailures),
      reviewFingerprint: fingerprint(blockingReviews),
    };
    return evidence;
  }
  findWorktree(
    fleetBranches: string[],
    candidateBranch: string,
    allowOperatorFallback: boolean,
  ): Promise<string | null> {
    return this.#worktreeManager.findWorktree(
      fleetBranches,
      candidateBranch,
      allowOperatorFallback,
    );
  }

  assignWorktreeBranch(
    worktree: string,
    pr: PrIdentity,
  ): Promise<WorktreeContext> {
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
    intent?: "restack" | "inherited-commits",
  ): Promise<{ headSha: string }> {
    return this.#gitOperations.publishRestack(pr, signal, intent);
  }
}
