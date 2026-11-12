import { createHash } from "node:crypto";
import type { GitHubClient } from "./github.ts";
import type {
  CiPullRequest,
  CiReview,
  CiRules,
  CommitCheck,
  PrDecision,
} from "./github/schemas.ts";
import {
  DECISION_MAX_AGE_MS,
  GITHUB_READ_INTERVAL_MS,
  MIN_GITHUB_GAP_MS,
  nextPeriodicRead,
  RULES_MAX_AGE_MS,
  SHARED_MAX_AGE_MS,
} from "./github/budget.ts";
import { getMainStatus, type MainStatus } from "./main.ts";
import type { Snapshot } from "./readiness.ts";
import {
  getWoodpeckerPipelineForCommit,
  pipelineUrl,
  type WoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";

export type ObserverTiming = {
  /** Base gap between periodic GitHub reads of one PR. */
  githubIntervalMs: number;
  /** Minimum gap before an event-driven GitHub read. */
  minGitHubGapMs: number;
  /** Non-final reads reuse a shared body this recent. */
  sharedMaxAgeMs: number;
  /** A memoized review decision is re-asked after this long. */
  decisionMaxAgeMs: number;
  /** Non-final reads reuse the base branch's rules this long. */
  rulesMaxAgeMs: number;
  /** This process's fixed share (0–1) of the post-reset resume window. */
  resumeOffset: number;
};

/**
 * Why the GitHub half is read: a final `forced` read, an `event` (a pipeline
 * transition or a new commit), or the `periodic` interval.
 */
type ReadMode = "forced" | "event" | "periodic";

/** The GitHub half of a snapshot: PR metadata, checks, reviews, and the decision. */
type GitHubRead = {
  number: number;
  pr: CiPullRequest;
  rules: CiRules;
  checks: CommitCheck[];
  reviews: CiReview[];
  decision: PrDecision;
  readAt: number;
  /** The Woodpecker pipeline identity and status this read was taken with. */
  pipelineKey: string;
};

function pipelineKey(pipeline: WoodpeckerPipeline | null): string {
  return pipeline === null
    ? "none"
    : `${String(pipeline.number)}:${String(pipeline.rerun_count ?? 0)}:${pipeline.status}`;
}

/**
 * Snapshots split into a Woodpecker half, read on every poll and event, and a
 * GitHub half that is reused between reads. GitHub is read when a final
 * (forced) snapshot needs it, when the PR's pipeline is created, changes
 * attempt, or changes status, when an event names a commit the last read did
 * not, and otherwise at most every `githubIntervalMs` (longer as the shared
 * budget runs low). Rules are shared for five minutes and main for 60s;
 * forced final snapshots refresh every gate.
 */
export class CiObserver {
  #main: { status: MainStatus; readAt: number } | null = null;
  #github: GitHubRead | null = null;
  #newCommit = false;
  readonly #hintedCommits = new Set<string>();
  readonly timing: ObserverTiming;
  /** GitHub halves actually read (for diagnostics and the budget simulation). */
  githubReads = 0;

  constructor(
    readonly github: GitHubClient,
    readonly woodpecker: WoodpeckerConfig,
    timing: Partial<ObserverTiming> = {},
  ) {
    this.timing = {
      githubIntervalMs: GITHUB_READ_INTERVAL_MS,
      minGitHubGapMs: MIN_GITHUB_GAP_MS,
      sharedMaxAgeMs: SHARED_MAX_AGE_MS,
      decisionMaxAgeMs: DECISION_MAX_AGE_MS,
      rulesMaxAgeMs: RULES_MAX_AGE_MS,
      resumeOffset: Math.random(),
      ...timing,
    };
  }

  /**
   * A Woodpecker event named this PR commit. A commit the last GitHub read
   * did not show is a push, so the next snapshot reads GitHub again.
   */
  notePrCommit(number: number, commit: string): void {
    const read = this.#github;
    if (
      read?.number !== number ||
      read.pr.head.sha === commit ||
      this.#hintedCommits.has(commit)
    )
      return;
    this.#hintedCommits.add(commit);
    this.#newCommit = true;
  }

  async snapshot(
    number: number,
    signal?: AbortSignal,
    force = false,
  ): Promise<Snapshot> {
    const read = this.#github?.number === number ? this.#github : null;
    if (force) return this.#readAll(number, signal, "forced");
    if (read === null) return this.#readAll(number, signal, "periodic");
    const due = await this.#githubDue(read);
    if (due !== null) return this.#readAll(number, signal, due);
    const [pipeline, main] = await Promise.all([
      getWoodpeckerPipelineForCommit(
        read.pr.head.sha,
        this.woodpecker,
        number,
        signal,
      ),
      this.main(signal),
    ]);
    const transitioned =
      pipelineKey(pipeline) !== read.pipelineKey &&
      this.github.now() - read.readAt >= this.timing.minGitHubGapMs;
    return transitioned
      ? this.#readAll(number, signal, "event")
      : this.#compose(read, pipeline, main, "cached");
  }

  async #githubDue(read: GitHubRead): Promise<ReadMode | null> {
    const now = this.github.now();
    if (this.#newCommit && now - read.readAt >= this.timing.minGitHubGapMs)
      return "event";
    const buckets = await Promise.all([
      this.github.bucket("graphql"),
      this.github.bucket("core"),
    ]);
    const next = nextPeriodicRead(
      read.readAt,
      buckets,
      this.timing.githubIntervalMs,
      this.timing.resumeOffset,
    );
    return now >= next ? "periodic" : null;
  }

  /**
   * Read the GitHub half. Only a periodic read accepts another process's
   * recent body; an event-driven read (a transition or new commit) asks
   * GitHub, and a forced read also re-asks the rules and the decision.
   */
  async #readAll(
    number: number,
    signal: AbortSignal | undefined,
    mode: ReadMode,
  ): Promise<Snapshot> {
    const force = mode === "forced";
    this.#newCommit = false;
    this.githubReads++;
    const maxAge = mode === "periodic" ? this.timing.sharedMaxAgeMs : 0;
    const pr = await this.github.pr(number, signal, maxAge);
    const [rules, main, pipeline, checks, reviews] = await Promise.all([
      this.rules(pr.base.ref, signal, force),
      this.main(signal, force),
      getWoodpeckerPipelineForCommit(
        pr.head.sha,
        this.woodpecker,
        number,
        signal,
      ),
      this.github.checks(pr.head.sha, signal, maxAge),
      this.github.reviews(number, signal, maxAge),
    ]);
    // reviewDecision is a function of the head, base, reviews and rules. An
    // unchanged fingerprint reuses a recent decision; a final read asks again.
    const inputs = createHash("sha256")
      .update(JSON.stringify({ pr, reviews, rules }))
      .digest("hex");
    const decision = await this.github.memoizedDecision(
      number,
      inputs,
      signal,
      force ? 0 : this.timing.decisionMaxAgeMs,
    );
    const read: GitHubRead = {
      number,
      pr,
      rules,
      checks,
      reviews,
      decision,
      readAt: this.github.now(),
      pipelineKey: pipelineKey(pipeline),
    };
    this.#github = read;
    return this.#compose(read, pipeline, main, mode);
  }

  #compose(
    read: GitHubRead,
    pipeline: WoodpeckerPipeline | null,
    main: MainStatus,
    mode: ReadMode | "cached",
  ): Snapshot {
    const { pr, decision } = read;
    // An independent metadata read can catch a push during collection. Preserve
    // its new identity so the pinned-head evaluator returns head_changed.
    return {
      pr: {
        ...pr,
        head: { sha: decision.headRefOid },
        base: { ...pr.base, sha: decision.baseRefOid },
      },
      pipeline,
      rules: read.rules,
      main,
      checks: read.checks,
      reviews: read.reviews,
      reviewDecision: decision.reviewDecision,
      consistent:
        pr.head.sha === decision.headRefOid &&
        pr.base.sha === decision.baseRefOid,
      pipelineUrl:
        pipeline === null ? null : pipelineUrl(pipeline, this.woodpecker),
      githubFresh: mode === "forced",
    };
  }

  rules(branch: string, signal?: AbortSignal, force = false): Promise<CiRules> {
    return this.github.memoizedRules(
      branch,
      signal,
      force ? 0 : this.timing.rulesMaxAgeMs,
    );
  }

  async main(signal?: AbortSignal, force = false): Promise<MainStatus> {
    if (
      !force &&
      this.#main !== null &&
      this.github.now() - this.#main.readAt < 60_000
    )
      return this.#main.status;
    const status = await getMainStatus(
      this.github,
      this.woodpecker,
      signal,
      force ? 0 : this.timing.sharedMaxAgeMs,
    );
    this.#main = { status, readAt: this.github.now() };
    return status;
  }
}
