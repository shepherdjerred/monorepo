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

/** Step types reported by Woodpecker v3 (`server/model/step.go`). */
const StepSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string(),
  state: z.enum(PIPELINE_STATUSES),
  exit_code: z.number().int(),
  /** Unix seconds; 0 until the step starts. */
  started: z.number().int().default(0),
  /** Unix seconds; 0 until the step finishes. */
  finished: z.number().int().default(0),
  type: z.string(),
});

const WorkflowSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string(),
  state: z.enum(PIPELINE_STATUSES),
  started: z.number().int().default(0),
  finished: z.number().int().default(0),
  children: z.array(StepSchema).nullable().default([]),
});

const PipelineDetailSchema = PipelineSchema.extend({
  event: z.string(),
  branch: z.string(),
  author: z.string(),
  started: z.number().int(),
  forge_url: z.string(),
  workflows: z.array(WorkflowSchema).nullable().default([]),
});

export type WoodpeckerStep = {
  pid: number;
  name: string;
  state: WoodpeckerPipelineStatus;
  exitCode: number;
  type: string;
  startedAt: string | undefined;
  finishedAt: string | undefined;
  url: string;
};

export type WoodpeckerWorkflow = {
  pid: number;
  name: string;
  state: WoodpeckerPipelineStatus;
  startedAt: string | undefined;
  finishedAt: string | undefined;
  steps: WoodpeckerStep[];
};

export type WoodpeckerPipelineDetail = WoodpeckerPipeline & {
  event: string;
  branch: string;
  author: string;
  startedAt: string | undefined;
  forgeUrl: string;
  workflows: WoodpeckerWorkflow[];
};

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

function optionalIso(seconds: number): string | undefined {
  return seconds === 0 ? undefined : isoFromUnix(seconds);
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
      url: this.#pipelineUrl(pipeline.number),
      commit: pipeline.commit,
      message: pipeline.message.split("\n")[0] ?? "",
      createdAt: isoFromUnix(pipeline.created),
      finishedAt: optionalIso(pipeline.finished),
    }));
  }

  /** One pipeline with its workflows and steps. */
  async pipeline(number: number): Promise<WoodpeckerPipelineDetail> {
    const url = new URL(
      `/api/repos/${String(this.#repoId)}/pipelines/${String(number)}`,
      this.#baseUrl,
    );
    const pipeline = await fetchJson(
      this.#fetch,
      {
        upstream: "woodpecker",
        url,
        init: {
          headers: { accept: "application/json", ...bearer(this.#token) },
        },
      },
      PipelineDetailSchema,
    );
    const pipelineUrl = this.#pipelineUrl(pipeline.number);
    return {
      number: pipeline.number,
      status: pipeline.status,
      url: pipelineUrl,
      commit: pipeline.commit,
      message: pipeline.message,
      createdAt: isoFromUnix(pipeline.created),
      finishedAt: optionalIso(pipeline.finished),
      startedAt: optionalIso(pipeline.started),
      event: pipeline.event,
      branch: pipeline.branch,
      author: pipeline.author,
      forgeUrl: pipeline.forge_url,
      workflows: (pipeline.workflows ?? []).map((workflow) => ({
        pid: workflow.pid,
        name: workflow.name,
        state: workflow.state,
        startedAt: optionalIso(workflow.started),
        finishedAt: optionalIso(workflow.finished),
        steps: (workflow.children ?? []).map((step) => ({
          pid: step.pid,
          name: step.name,
          state: step.state,
          exitCode: step.exit_code,
          type: step.type,
          startedAt: optionalIso(step.started),
          finishedAt: optionalIso(step.finished),
          url: `${pipelineUrl}/${String(step.pid)}`,
        })),
      })),
    };
  }

  #pipelineUrl(number: number) {
    return new URL(
      `/repos/${String(this.#repoId)}/pipeline/${String(number)}`,
      this.#baseUrl,
    ).toString();
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
