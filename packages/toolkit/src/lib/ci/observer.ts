import type { GitHubClient } from "./github.ts";
import { type CiRules } from "./github.ts";
import { getMainStatus, type MainStatus } from "./main.ts";
import type { Snapshot } from "./readiness.ts";
import {
  getWoodpeckerPipelineForCommit,
  pipelineUrl,
  type WoodpeckerConfig,
} from "#lib/woodpecker/ci.ts";

/** Cache slowly changing inputs; forced final snapshots refresh every gate. */
export class CiObserver {
  #rules: { branch: string; rules: CiRules; readAt: number } | null = null;
  #main: { status: MainStatus; readAt: number } | null = null;
  constructor(
    readonly github: GitHubClient,
    readonly woodpecker: WoodpeckerConfig,
  ) {}

  async snapshot(
    number: number,
    signal?: AbortSignal,
    force = false,
  ): Promise<Snapshot> {
    const pr = await this.github.pr(number, signal);
    const [rules, main, pipeline, checks, reviews, decision] =
      await Promise.all([
        this.rules(pr.base.ref, signal, force),
        this.main(signal, force),
        getWoodpeckerPipelineForCommit(
          pr.head.sha,
          this.woodpecker,
          number,
          signal,
        ),
        this.github.checks(pr.head.sha, signal),
        this.github.reviews(number, signal),
        this.github.decision(number, signal),
      ]);
    // An independent metadata read can catch a push during collection. Preserve
    // its new identity so the pinned-head evaluator returns head_changed.
    return {
      pr: {
        ...pr,
        head: { sha: decision.headRefOid },
        base: { ...pr.base, sha: decision.baseRefOid },
      },
      pipeline,
      rules,
      main,
      checks,
      reviews,
      reviewDecision: decision.reviewDecision,
      consistent:
        pr.head.sha === decision.headRefOid &&
        pr.base.sha === decision.baseRefOid,
      pipelineUrl:
        pipeline === null ? null : pipelineUrl(pipeline, this.woodpecker),
    };
  }

  async rules(
    branch: string,
    signal?: AbortSignal,
    force = false,
  ): Promise<CiRules> {
    if (
      !force &&
      this.#rules?.branch === branch &&
      Date.now() - this.#rules.readAt < 60_000
    )
      return this.#rules.rules;
    const rules = await this.github.rules(branch, signal);
    this.#rules = { branch, rules, readAt: Date.now() };
    return rules;
  }

  async main(signal?: AbortSignal, force = false): Promise<MainStatus> {
    if (
      !force &&
      this.#main !== null &&
      Date.now() - this.#main.readAt < 60_000
    )
      return this.#main.status;
    const status = await getMainStatus(this.github, this.woodpecker, signal);
    this.#main = { status, readAt: Date.now() };
    return status;
  }
}
