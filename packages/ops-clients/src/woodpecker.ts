import { z } from "zod";
import {
  bearer,
  fetchJson,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

/** Woodpecker v3 pipeline statuses (`server/model/const.go`). */
const PIPELINE_STATUSES = [
  "created",
  "pending",
  "blocked",
  "declined",
  "running",
  "success",
  "failure",
  "error",
  "killed",
  "canceled",
  "skipped",
] as const;

const PipelineSchema = z.object({
  number: z.number().int().positive(),
  status: z.enum(PIPELINE_STATUSES),
  commit: z.string(),
  message: z.string(),
  /** Unix seconds. */
  created: z.number().int(),
  /** Unix seconds; 0 until the pipeline finishes. */
  finished: z.number().int(),
});

export type WoodpeckerPipelineStatus = (typeof PIPELINE_STATUSES)[number];

export type WoodpeckerPipeline = {
  number: number;
  status: WoodpeckerPipelineStatus;
  url: string;
  commit: string;
  message: string;
  createdAt: string;
  finishedAt: string | undefined;
};

/**
 * Terminal statuses that say whether a branch is green. `error` counts: it is
 * a configuration or system failure of the branch's own pipeline, which leaves
 * the branch as unverified as a failing step does.
 */
export const VERDICT_STATUSES: ReadonlySet<WoodpeckerPipelineStatus> = new Set([
  "success",
  "failure",
  "error",
]);

export type BranchStatus = {
  /** Newest push pipeline, whatever its status. */
  latest: WoodpeckerPipeline | undefined;
  /** Newest push pipeline that reached a verdict. */
  verdict: WoodpeckerPipeline | undefined;
};

function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Read-only Woodpecker REST client scoped to one repository. */
export class WoodpeckerClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #repoId: number;
  readonly #fetch: Fetch;

  constructor(options: {
    baseUrl: string;
    token: string;
    repoId: number;
    fetch?: Fetch;
  }) {
    this.#baseUrl = options.baseUrl;
    this.#token = options.token;
    this.#repoId = options.repoId;
    this.#fetch = options.fetch ?? fetch;
  }

  /**
   * Newest push pipelines on a branch.
   *
   * Push only: Woodpecker reports a pull request's pipeline under its target
   * branch, so without the event filter every pull request against `main`
   * would read as `main`'s own status.
   */
  async recentPushPipelines(
    branch: string,
    count: number,
  ): Promise<WoodpeckerPipeline[]> {
    const url = new URL(
      `/api/repos/${String(this.#repoId)}/pipelines`,
      this.#baseUrl,
    );
    url.searchParams.set("branch", branch);
    url.searchParams.set("event", "push");
    url.searchParams.set("perPage", String(count));
    const pipelines = await fetchJson(
      this.#fetch,
      {
        upstream: "woodpecker",
        url,
        init: {
          headers: { accept: "application/json", ...bearer(this.#token) },
        },
      },
      z.array(PipelineSchema),
    );
    return pipelines.map((pipeline) => ({
      number: pipeline.number,
      status: pipeline.status,
      url: new URL(
        `/repos/${String(this.#repoId)}/pipeline/${String(pipeline.number)}`,
        this.#baseUrl,
      ).toString(),
      commit: pipeline.commit,
      message: pipeline.message.split("\n")[0] ?? "",
      createdAt: isoFromUnix(pipeline.created),
      finishedAt:
        pipeline.finished === 0 ? undefined : isoFromUnix(pipeline.finished),
    }));
  }

  /** The newest push pipeline and the newest verdict on a branch. */
  async branchStatus(branch: string): Promise<BranchStatus> {
    const pipelines = await this.recentPushPipelines(branch, 20);
    const sorted = pipelines.toSorted(
      (left, right) => right.number - left.number,
    );
    return {
      latest: sorted[0],
      verdict: sorted.find((pipeline) => VERDICT_STATUSES.has(pipeline.status)),
    };
  }
}
