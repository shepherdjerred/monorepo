import type { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import type {
  CiRun,
  CiWorkflow,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import { z } from "zod";

export type PipelineClient = Pick<
  WoodpeckerClient,
  "pipeline" | "pipelineConfig" | "pipelines" | "queue"
>;
export type PipelineDetail = Awaited<ReturnType<PipelineClient["pipeline"]>>;
export type PipelineSummary = Awaited<
  ReturnType<PipelineClient["pipelines"]>
>[number];
export type Queue = Awaited<ReturnType<PipelineClient["queue"]>>;
type QueueTask = Queue["tasks"][number];
type PipelineConfig = Awaited<ReturnType<PipelineClient["pipelineConfig"]>>;
export type SourceFailure = (source: string, error: unknown) => void;

const GateYamlSchema = z.object({
  name: z.literal("ci-complete").optional(),
  depends_on: z.array(z.string().min(1)).min(1),
});

function readGateConfig(configs: PipelineConfig): string[] | null {
  const gates = configs.filter((config) =>
    /(?:^|\/)ci-complete(?:\.ya?ml)?$/u.test(config.name),
  );
  if (gates.length !== 1 || gates[0] === undefined) return null;
  // Decode only the gate dependency list. The remaining YAML can contain
  // arbitrary commands and environment keys and is never published to Hub.
  const value: unknown = Bun.YAML.parse(gates[0].data);
  const parsed = GateYamlSchema.safeParse(value);
  return parsed.success ? parsed.data.depends_on : null;
}

function requiredNames(
  names: readonly string[],
  detail: PipelineDetail,
): string[] | null {
  if (names.length === 0 || new Set(names).size !== names.length) return null;
  const includesExactNames = names.every(
    (name) =>
      name !== "ci-complete" &&
      detail.workflows.filter((workflow) => workflow.name === name).length ===
        1,
  );
  return includesExactNames ? [...names].sort() : null;
}

export function isPrVerification(pipeline: PipelineSummary): boolean {
  return (
    !pipeline.isDraft &&
    prNumber(pipeline.ref) !== null &&
    (pipeline.event === "pull_request" ||
      (pipeline.event === "pull_request_metadata" &&
        pipeline.eventReasons.includes("ready_for_review")))
  );
}

export async function requiredWorkflows(
  client: PipelineClient,
  pipeline: PipelineDetail,
  options: {
    signal: AbortSignal;
    onFailure: SourceFailure;
    historical: boolean;
  },
): Promise<{ names: string[] | null; retry: boolean }> {
  const missing = { names: null, retry: false };
  if (!isPrVerification(pipeline)) return missing;
  const gate = pipeline.workflows.find(
    (workflow) => workflow.name === "ci-complete",
  );
  if (gate === undefined) return missing;
  const recorded = requiredNames(gate.dependsOn, pipeline);
  if (recorded !== null && !options.historical) {
    return { names: recorded, retry: false };
  }
  try {
    const config = await client.pipelineConfig(pipeline.number, options.signal);
    const names = readGateConfig(config);
    if (names !== null) {
      const configured = requiredNames(names, pipeline);
      // A mismatch could be a concurrent rerun. Withhold that graph.
      const mismatch =
        recorded !== null && configured?.join("\0") !== recorded.join("\0");
      return { names: mismatch ? null : configured, retry: false };
    }
    return { names: recorded, retry: false };
  } catch (error: unknown) {
    options.onFailure("woodpecker_pipeline_config", error);
    return { names: recorded, retry: recorded === null };
  }
}

function prNumber(ref: string): number | null {
  const identifier = /^refs\/pull\/(\d+)(?:\/|$)/u.exec(ref)?.[1];
  const number = Number(identifier);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function activePipeline(status: string): boolean {
  return (
    status === "created" ||
    status === "pending" ||
    status === "running" ||
    status === "blocked"
  );
}

function queueState(task: QueueTask): string {
  return task.state === "waiting" ? "waiting_on_deps" : task.state;
}

export function queueOnlyWorkflows(
  pipeline: PipelineSummary,
  tasks: readonly QueueTask[],
  paused: boolean,
): CiWorkflow[] {
  return tasks.flatMap((task) => {
    if (task.pipelineId !== pipeline.id || task.name === "") return [];
    return [
      {
        id: task.id,
        name: task.name,
        state: queueState(task),
        startedAt: null,
        finishedAt: null,
        url: `${pipeline.url}/${String(task.pid)}`,
        blocker: queueBlocker(queueState(task), paused),
      },
    ];
  });
}

export function summarizePipeline(
  pipeline: PipelineSummary | PipelineDetail,
): CiRun {
  const pr = prNumber(pipeline.ref);
  const headRef = pipeline.refspec.split(":", 1)[0];
  const head = headRef?.replace(/^\+?refs\/heads\//u, "");
  return {
    pipeline: pipeline.number,
    attempt: pipeline.attempt,
    commit: pipeline.commit,
    pr,
    branch:
      pr !== null && head !== undefined && head.length > 0
        ? head
        : pipeline.branch,
    event: pipeline.event,
    state: pipeline.status,
    url: pipeline.url,
    createdAt: pipeline.createdAt,
    finishedAt: pipeline.finishedAt ?? null,
    requiredWorkflows: null,
    workflows: [],
  };
}

function queueBlocker(state: string, queuePaused: boolean): string | null {
  if (state === "waiting_on_deps") return "Waiting on dependencies";
  if (state === "ready") {
    return queuePaused ? "Queue paused" : "Waiting for a runner";
  }
  return state === "blocked" ? "Waiting for approval" : null;
}

function workflowBlocker(
  state: string,
  workflow: PipelineDetail["workflows"][number],
  pipeline: PipelineDetail,
  queuePaused: boolean,
): string | null {
  if (state === "waiting_on_deps") {
    const names = workflow.dependsOn.filter(
      (name) =>
        pipeline.workflows.find((candidate) => candidate.name === name)
          ?.state !== "success",
    );
    if (names.length > 0) return `Waiting on ${names.join(", ")}`;
  }
  return queueBlocker(state, queuePaused);
}

export function pipelineWorkflows(
  pipeline: PipelineDetail,
  tasks: readonly QueueTask[],
  queuePaused: boolean,
): CiWorkflow[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return pipeline.workflows.map((workflow) => {
    const task = workflow.id === null ? undefined : tasksById.get(workflow.id);
    // Keep the more recent detail read authoritative for terminal transitions.
    const state =
      task !== undefined &&
      (workflow.state === "pending" || workflow.state === "created")
        ? queueState(task)
        : workflow.state;
    return {
      id: workflow.id ?? String(workflow.pid),
      name: workflow.name,
      state,
      startedAt: workflow.startedAt ?? null,
      finishedAt: workflow.finishedAt ?? null,
      url: `${pipeline.url}/${String(workflow.pid)}`,
      blocker: workflowBlocker(state, workflow, pipeline, queuePaused),
    };
  });
}

/** Each worker finishes all API reads for one pipeline before claiming another. */
export async function readPipelineDetails<T, Row>(
  entries: readonly T[],
  operation: (entry: T) => Promise<Row>,
  onFailure: SourceFailure,
  signal: AbortSignal,
): Promise<{ runs: Row[]; partial: boolean }> {
  const runs: Row[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (!signal.aborted && next < entries.length) {
        const entry = entries[next++];
        if (entry === undefined) break;
        try {
          runs.push(await operation(entry));
        } catch (error: unknown) {
          onFailure("woodpecker_pipeline_detail", error);
        }
      }
    }),
  );
  return { runs, partial: runs.length < entries.length };
}
