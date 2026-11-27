import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  bearer,
  fetchJson,
  UpstreamError,
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
  id: z.int().positive().optional(),
  pid: z.number().int().positive(),
  name: z.string(),
  state: z.enum(PIPELINE_STATUSES),
  started: z.number().int().default(0),
  finished: z.number().int().default(0),
  depends_on: z.array(z.string()).nullish(),
  children: z.array(StepSchema).nullable().default([]),
});

const PipelineSummarySchema = PipelineSchema.extend({
  id: z.int().positive().optional(),
  event: z.string(),
  branch: z.string(),
  ref: z.string().default(""),
  refspec: z.string().default(""),
  rerun_count: z.int().nonnegative().default(0),
  pr_draft: z.boolean().default(false),
  event_reason: z.array(z.string()).nullish(),
});

const PipelineDetailSchema = PipelineSummarySchema.extend({
  author: z.string(),
  started: z.number().int(),
  forge_url: z.string(),
  workflows: z.array(WorkflowSchema).nullable().default([]),
});

const QueueTaskSchema = z.object({
  id: z.string().min(1),
  pid: z.int().positive(),
  name: z.string(),
  repo_id: z.int().positive(),
  pipeline_id: z.int().nonnegative().optional(),
  pipeline_number: z.int().positive().optional(),
  created: z.int().nonnegative(),
  dependencies: z.array(z.string()).nullish(),
  dep_status: z.record(z.string(), z.enum(PIPELINE_STATUSES)).nullish(),
});

const QueueSchema = z.object({
  paused: z.boolean(),
  stats: z.object({
    pending_count: z.int().nonnegative(),
    waiting_on_deps_count: z.int().nonnegative(),
    running_count: z.int().nonnegative(),
    worker_count: z.int().nonnegative(),
  }),
  pending: z.array(QueueTaskSchema),
  waiting_on_deps: z.array(QueueTaskSchema),
  running: z.array(QueueTaskSchema),
});

const PipelineConfigSchema = z.object({ name: z.string(), data: z.base64() });

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
  id: string | null;
  pid: number;
  name: string;
  state: WoodpeckerPipelineStatus;
  startedAt: string | undefined;
  finishedAt: string | undefined;
  dependsOn: string[];
  steps: WoodpeckerStep[];
};

export type WoodpeckerPipelineDetail = WoodpeckerPipelineSummary & {
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

export type WoodpeckerPipelineSummary = WoodpeckerPipeline & {
  id: number | null;
  event: string;
  branch: string;
  ref: string;
  refspec: string;
  attempt: number;
  isDraft: boolean;
  eventReasons: string[];
};

export type WoodpeckerQueueTask = {
  id: string;
  repoId: number;
  pipelineId: number | null;
  pipelineNumber: number | null;
  pid: number;
  name: string;
  state: "ready" | "waiting" | "running";
  pipelineCreatedAt: string | null;
  dependencies: string[];
  dependencyStates: Record<string, WoodpeckerPipelineStatus>;
};

export type WoodpeckerQueue = {
  paused: boolean;
  ready: number;
  waitingOnDependencies: number;
  running: number;
  workerCount: number;
  tasks: WoodpeckerQueueTask[];
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

function queueTasks(
  tasks: readonly z.infer<typeof QueueTaskSchema>[],
  state: WoodpeckerQueueTask["state"],
): WoodpeckerQueueTask[] {
  return tasks.map((task) => ({
    id: task.id,
    repoId: task.repo_id,
    pipelineId: task.pipeline_id === 0 ? null : (task.pipeline_id ?? null),
    pipelineNumber: task.pipeline_number ?? null,
    pid: task.pid,
    name: task.name,
    state,
    pipelineCreatedAt: optionalIso(task.created) ?? null,
    dependencies: task.dependencies ?? [],
    dependencyStates: task.dep_status ?? {},
  }));
}

/** Read-only Woodpecker REST client with repository-scoped pipeline reads. */
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

  #read<T extends z.ZodType>(
    url: string | URL,
    schema: T,
    signal?: AbortSignal,
  ) {
    return fetchJson(
      this.#fetch,
      {
        upstream: "woodpecker",
        url: typeof url === "string" ? new URL(url, this.#baseUrl) : url,
        init: {
          headers: { accept: "application/json", ...bearer(this.#token) },
        },
        ...(signal === undefined ? {} : { signal }),
      },
      schema,
    );
  }

  #summary(
    pipeline: z.infer<typeof PipelineSummarySchema>,
  ): WoodpeckerPipelineSummary {
    return {
      id: pipeline.id ?? null,
      number: pipeline.number,
      status: pipeline.status,
      url: this.#pipelineUrl(pipeline.number),
      commit: pipeline.commit,
      message: pipeline.message,
      createdAt: isoFromUnix(pipeline.created),
      finishedAt: optionalIso(pipeline.finished),
      event: pipeline.event,
      branch: pipeline.branch,
      ref: pipeline.ref,
      refspec: pipeline.refspec,
      attempt: pipeline.rerun_count,
      isDraft: pipeline.pr_draft,
      eventReasons: pipeline.event_reason ?? [],
    };
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
    const pipelines = await this.#read(url, z.array(PipelineSchema));
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

  /** One page of run metadata. Woodpecker orders by descending pipeline number. */
  async pipelines(options: {
    page: number;
    perPage: number;
    status?: WoodpeckerPipelineStatus;
    after?: string;
    signal?: AbortSignal;
  }): Promise<WoodpeckerPipelineSummary[]> {
    const url = new URL(
      `/api/repos/${String(this.#repoId)}/pipelines`,
      this.#baseUrl,
    );
    url.searchParams.set("page", String(options.page));
    url.searchParams.set("perPage", String(options.perPage));
    if (options.status !== undefined)
      url.searchParams.set("status", options.status);
    if (options.after !== undefined)
      url.searchParams.set("after", options.after);
    const pipelines = await this.#read(
      url,
      z.array(PipelineSummarySchema),
      options.signal,
    );
    return pipelines.map((pipeline) => this.#summary(pipeline));
  }

  /** Instance-wide scheduler state. Woodpecker requires administrator access. */
  async queue(signal?: AbortSignal): Promise<WoodpeckerQueue> {
    const queue = await this.#read("/api/queue/info", QueueSchema, signal);
    return {
      paused: queue.paused,
      ready: queue.stats.pending_count,
      waitingOnDependencies: queue.stats.waiting_on_deps_count,
      running: queue.stats.running_count,
      workerCount: queue.stats.worker_count,
      tasks: [
        ...queueTasks(queue.pending, "ready"),
        ...queueTasks(queue.waiting_on_deps, "waiting"),
        ...queueTasks(queue.running, "running"),
      ],
    };
  }

  /** One pipeline with its workflows and steps. */
  async pipeline(
    number: number,
    signal?: AbortSignal,
  ): Promise<WoodpeckerPipelineDetail> {
    const pipeline = await this.#read(
      `/api/repos/${String(this.#repoId)}/pipelines/${String(number)}`,
      PipelineDetailSchema,
      signal,
    );
    if (pipeline.number !== number) {
      throw new UpstreamError(
        "woodpecker",
        "pipeline response did not match the requested run",
      );
    }
    const summary = this.#summary(pipeline);
    return {
      ...summary,
      startedAt: optionalIso(pipeline.started),
      author: pipeline.author,
      forgeUrl: pipeline.forge_url,
      workflows: (pipeline.workflows ?? []).map((workflow) => ({
        id: workflow.id === undefined ? null : String(workflow.id),
        pid: workflow.pid,
        name: workflow.name,
        state: workflow.state,
        startedAt: optionalIso(workflow.started),
        finishedAt: optionalIso(workflow.finished),
        dependsOn: workflow.depends_on ?? [],
        steps: (workflow.children ?? []).map((step) => ({
          pid: step.pid,
          name: step.name,
          state: step.state,
          exitCode: step.exit_code,
          type: step.type,
          startedAt: optionalIso(step.started),
          finishedAt: optionalIso(step.finished),
          url: `${summary.url}/${String(step.pid)}`,
        })),
      })),
    };
  }

  /** Stored exact-run configuration. Woodpecker JSON-encodes file bytes as base64. */
  async pipelineConfig(
    number: number,
    signal?: AbortSignal,
  ): Promise<{ name: string; data: string }[]> {
    const files = await this.#read(
      `/api/repos/${String(this.#repoId)}/pipelines/${String(number)}/config`,
      z.array(PipelineConfigSchema),
      signal,
    );
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return files.map(({ name, data }) => ({
      name,
      data: decoder.decode(Buffer.from(data, "base64")),
    }));
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
