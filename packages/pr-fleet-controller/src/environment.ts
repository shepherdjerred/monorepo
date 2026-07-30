import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  automatedReviewFinding,
  fingerprint,
  isCurrentHostedReview,
  parseBuildkiteBuild,
  parseBuildkiteCommit,
  parseChecks,
  parsePrList,
  parseReviewPage,
  severityFromBody,
  splitRepo,
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

export class CommandFleetEnvironment implements FleetEnvironment {
  readonly #repo: string;
  readonly #checkout: string;
  readonly #worktreeRoot: string;
  readonly #gitOperations: GitOperations;

  constructor(repo: string, checkout: string, worktreeRoot: string) {
    this.#repo = repo;
    this.#checkout = checkout;
    this.#worktreeRoot = worktreeRoot;
    this.#gitOperations = new GitOperations({
      repo,
      run: async (request) => this.runLocalCommand(request),
      mustRun: async (executable, args, cwd, timeoutMs) =>
        this.#mustRun(executable, args, cwd, timeoutMs),
    });
  }

  async runLocalCommand(request: CommandRequest): Promise<CommandResult> {
    const baseOptions = {
      cwd: request.cwd,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
      env: Bun.env,
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
    timeoutMs = 120_000,
  ): Promise<string> {
    const result = await this.runLocalCommand({
      executable,
      args,
      cwd,
      timeoutMs,
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

  async #reviews(pr: PrIdentity): Promise<{
    findings: ReviewFinding[];
    hostedReviewComplete: boolean;
  }> {
    const { owner, name } = splitRepo(this.#repo);
    const findings: ReviewFinding[] = [];
    let hostedReviewComplete = false;
    let cursor: string | null = null;
    let hasNextPage = true;

    const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){
      repository(owner:$owner,name:$name){
        pullRequest(number:$number){
          reviewThreads(first:100,after:$cursor){
            pageInfo{hasNextPage endCursor}
            nodes{id isResolved isOutdated comments(first:100){nodes{body author{login}}}}
          }
          reviews(last:100){nodes{id body submittedAt author{login} commit{oid}}}
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
        const body = comment?.body ?? "";
        findings.push({
          id: thread.id,
          author: comment?.author?.login ?? "unknown",
          body,
          severity: severityFromBody(body),
          resolved: thread.isResolved,
          outdated: thread.isOutdated,
        });
      }
      for (const review of page.reviews.nodes) {
        const author = review.author?.login ?? "unknown";
        const finding = automatedReviewFinding({
          id: review.id,
          author,
          body: review.body,
          commit: review.commit?.oid ?? null,
          headSha: pr.headSha,
        });
        if (finding !== null) {
          findings.push(finding);
        }
        if (
          isCurrentHostedReview(author, review.commit?.oid ?? null, pr.headSha)
        ) {
          hostedReviewComplete = true;
        }
      }
      hasNextPage = page.reviewThreads.pageInfo.hasNextPage;
      cursor = page.reviewThreads.pageInfo.endCursor;
      if (hasNextPage && cursor === null) {
        throw new Error(
          `PR #${String(pr.number)} review pagination lost its cursor`,
        );
      }
    }
    return { findings, hostedReviewComplete };
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

  async findWorktree(branches: string[]): Promise<string | null> {
    const output = await this.#mustRun("git", [
      "worktree",
      "list",
      "--porcelain",
    ]);
    let currentPath: string | null = null;
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length);
      }
      if (line.startsWith("branch refs/heads/")) {
        const branch = line.slice("branch refs/heads/".length);
        if (currentPath !== null && branches.includes(branch)) {
          return currentPath;
        }
      }
    }
    return null;
  }

  async provisionWorktree(pr: PrIdentity, stackId: string): Promise<string> {
    if (pr.crossRepository) {
      throw new Error(
        `PR #${String(pr.number)} is cross-repository and needs an existing authorized worktree`,
      );
    }
    await mkdir(this.#worktreeRoot, { recursive: true });
    const worktreePath = path.join(this.#worktreeRoot, `stack-${stackId}`);
    const existing = await this.findWorktree([pr.headRefName]);
    if (existing !== null) {
      return existing;
    }
    const branchExists = await this.runLocalCommand({
      executable: "git",
      args: ["show-ref", "--verify", "--quiet", `refs/heads/${pr.headRefName}`],
      cwd: this.#checkout,
      timeoutMs: 30_000,
    });
    if (branchExists.exitCode !== 0) {
      await this.#mustRun("git", [
        "fetch",
        "origin",
        `refs/heads/${pr.headRefName}:refs/heads/${pr.headRefName}`,
      ]);
    }
    await this.#mustRun("git", [
      "worktree",
      "add",
      worktreePath,
      pr.headRefName,
    ]);
    return worktreePath;
  }

  async startRestack(pr: PrState): Promise<CommandResult> {
    return this.#gitOperations.startRestack(pr);
  }

  async continueRestack(pr: PrState, paths: string[]): Promise<CommandResult> {
    return this.#gitOperations.continueRestack(pr, paths);
  }

  async publishFix(
    pr: PrState,
    paths: string[],
    message: string,
  ): Promise<{ headSha: string }> {
    return this.#gitOperations.publishFix(pr, paths, message);
  }

  async publishRestack(pr: PrState): Promise<{ headSha: string }> {
    return this.#gitOperations.publishRestack(pr);
  }
}
