import { z } from "zod";

const CountSchema = z.int().nonnegative();
const TimestampSchema = z.iso.datetime();
const HttpUrlSchema = z.url({ protocol: /^https?$/u });

const CiQueueSchema = z.object({
  sampledAt: TimestampSchema,
  paused: z.boolean(),
  ready: CountSchema,
  waitingOnDependencies: CountSchema,
  running: CountSchema,
  oldestQueuedPipelineCreatedAt: TimestampSchema.nullable(),
});

const CiAdmissionSchema = z.object({
  sampledAt: TimestampSchema,
  compute: CountSchema.nullable(),
  gates: CountSchema.nullable(),
});

const CiWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.string().min(1),
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  url: HttpUrlSchema,
  blocker: z.string().nullable(),
});

const CiRunSchema = z.object({
  pipeline: z.int().positive(),
  attempt: CountSchema,
  commit: z.string(),
  pr: z.int().positive().nullable(),
  branch: z.string(),
  event: z.string().min(1),
  state: z.string().min(1),
  url: HttpUrlSchema,
  createdAt: TimestampSchema,
  finishedAt: TimestampSchema.nullable(),
  requiredWorkflows: z.array(z.string().min(1)).nullable(),
  workflows: z.array(CiWorkflowSchema),
});

export const CiDashboardSampleSchema = z.object({
  sampledAt: TimestampSchema,
  queue: CiQueueSchema.nullable(),
  admission: CiAdmissionSchema.nullable(),
  jobs: z
    .object({
      sampledAt: TimestampSchema,
      partial: z.boolean(),
      active: z.array(CiRunSchema),
      recent: z.array(CiRunSchema).max(20),
    })
    .nullable(),
});

const CiTimingAttemptSchema = z.object({
  pipeline: z.int().positive(),
  attempt: CountSchema,
  event: z.string().min(1),
  finishedAt: TimestampSchema,
  requiredWorkflows: z.array(z.string().min(1)).nullable(),
  turnaroundSeconds: z.number().nonnegative().nullable(),
  gateTailSeconds: z.number().nonnegative().nullable(),
  workflows: z.array(
    z.object({
      name: z.string().min(1),
      durationSeconds: z.number().nonnegative(),
    }),
  ),
});

export const CI_TIMING_MAX_ATTEMPTS = 100;
export const CI_TIMING_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

export const CiTimingHistorySchema = z.object({
  sampledAt: TimestampSchema,
  attempts: z.array(CiTimingAttemptSchema).max(CI_TIMING_MAX_ATTEMPTS),
});

const CiEstimateSchema = z.object({
  kind: z.enum(["rough", "refined", "running"]),
  earliestAt: TimestampSchema,
  latestAt: TimestampSchema,
});

const CiEstimatesSchema = z.object({
  runs: z.record(z.string(), CiEstimateSchema),
  workflows: z.record(z.string(), CiEstimateSchema),
});

export const CiDashboardResponseSchema = z.object({
  enabled: z.boolean(),
  sample: CiDashboardSampleSchema.nullable(),
  stale: z.boolean(),
  unavailableSources: z.array(z.enum(["queue", "admission", "jobs"])),
  estimates: CiEstimatesSchema,
});

export type CiDashboardSample = z.infer<typeof CiDashboardSampleSchema>;
export type CiDashboardResponse = z.infer<typeof CiDashboardResponseSchema>;
export type CiRun = z.infer<typeof CiRunSchema>;
export type CiWorkflow = z.infer<typeof CiWorkflowSchema>;
export type CiTimingHistory = z.infer<typeof CiTimingHistorySchema>;
export type CiTimingAttempt = z.infer<typeof CiTimingAttemptSchema>;
export type CiEstimate = z.infer<typeof CiEstimateSchema>;
export type CiEstimates = z.infer<typeof CiEstimatesSchema>;

const COMPLETION_WORKFLOW = "ci-complete";
const MIN_SAMPLES = 10;
const JOB_STALE_AFTER_MS = 3 * 60 * 1000;
const TIMINGS_STALE_AFTER_MS = 45 * 60 * 1000;
const ACTIVE_WORKFLOW_STATES = new Set([
  "created",
  "pending",
  "ready",
  "waiting",
  "waiting_on_deps",
  "running",
]);
const ACTIVE_RUN_STATES = new Set(["created", "pending", "running"]);

export function ciRunKey(
  run: Pick<CiRun, "pipeline" | "attempt" | "commit">,
): string {
  return `${String(run.pipeline)}:${String(run.attempt)}:${run.commit}`;
}

export function ciWorkflowKey(run: CiRun, workflow: CiWorkflow): string {
  return `${ciRunKey(run)}:${workflow.id}`;
}

export function isCiSampleStale(sampledAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(sampledAt) >= JOB_STALE_AFTER_MS;
}

function durationSeconds(
  start: string | null,
  end: string | null,
): number | null {
  if (start === null || end === null) return null;
  const seconds = (Date.parse(end) - Date.parse(start)) / 1000;
  return seconds >= 0 ? seconds : null;
}

function workflowNamed(run: CiRun, name: string): CiWorkflow | undefined {
  const matches = run.workflows.filter((workflow) => workflow.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function prerequisites(run: CiRun): CiWorkflow[] | null {
  const names = run.requiredWorkflows;
  if (names === null || names.length === 0) return null;
  if (
    new Set(names).size !== names.length ||
    names.includes(COMPLETION_WORKFLOW)
  )
    return null;
  const workflows = names
    .map((name) => workflowNamed(run, name))
    .filter((workflow) => workflow !== undefined);
  return workflows.length === names.length ? workflows : null;
}

function lastSuccessfulFinish(workflows: readonly CiWorkflow[]): string | null {
  const times: string[] = [];
  for (const workflow of workflows) {
    if (workflow.state !== "success" || workflow.finishedAt === null)
      return null;
    times.push(workflow.finishedAt);
  }
  return (
    times.toSorted((left, right) => Date.parse(right) - Date.parse(left))[0] ??
    null
  );
}

/** Keep only the timestamps and names used by the estimator. */
export function ciTimingAttempt(run: CiRun): CiTimingAttempt | null {
  const gate = workflowNamed(run, COMPLETION_WORKFLOW);
  if (
    run.finishedAt === null ||
    (run.state !== "success" && gate?.state !== "success")
  ) {
    return null;
  }
  const required = prerequisites(run);
  const gateFinishedAt = gate?.state === "success" ? gate.finishedAt : null;
  const requiredFinishedAt =
    required === null ? null : lastSuccessfulFinish(required);
  const workflows = run.workflows.flatMap((workflow) => {
    if (
      workflow.state !== "success" ||
      workflowNamed(run, workflow.name) === undefined
    )
      return [];
    const duration = durationSeconds(workflow.startedAt, workflow.finishedAt);
    return duration === null
      ? []
      : [{ name: workflow.name, durationSeconds: duration }];
  });
  return {
    pipeline: run.pipeline,
    attempt: run.attempt,
    event: run.event,
    finishedAt: run.finishedAt,
    requiredWorkflows: required?.map((workflow) => workflow.name) ?? null,
    turnaroundSeconds: durationSeconds(run.createdAt, gateFinishedAt),
    gateTailSeconds: durationSeconds(requiredFinishedAt, gateFinishedAt),
    workflows,
  };
}

type TimeRange = { earliest: number; latest: number };

/** Use observed totals that survived this long, measured from the original start. */
function conditionalRange(
  durations: readonly number[],
  start: number,
  asOf: number,
): TimeRange | null {
  const elapsed = Math.max(0, (asOf - start) / 1000);
  const matching = durations
    .filter((duration) => duration >= elapsed)
    .toSorted((a, b) => a - b);
  if (matching.length < MIN_SAMPLES) return null;
  const lower = matching[Math.ceil(matching.length * 0.2) - 1];
  const upper = matching[Math.ceil(matching.length * 0.8) - 1];
  return lower === undefined || upper === undefined
    ? null
    : { earliest: start + lower * 1000, latest: start + upper * 1000 };
}

function estimate(kind: CiEstimate["kind"], range: TimeRange): CiEstimate {
  return {
    kind,
    earliestAt: new Date(range.earliest).toISOString(),
    latestAt: new Date(range.latest).toISOString(),
  };
}

function workflowFinish(
  workflow: CiWorkflow,
  history: readonly CiTimingAttempt[],
  asOf: number,
): TimeRange | null {
  if (
    workflow.state !== "running" ||
    workflow.startedAt === null ||
    workflow.finishedAt !== null
  ) {
    return null;
  }
  const durations = history.flatMap((attempt) =>
    attempt.workflows
      .filter((sample) => sample.name === workflow.name)
      .map((sample) => sample.durationSeconds),
  );
  return conditionalRange(durations, Date.parse(workflow.startedAt), asOf);
}

function workflowCountBand(count: number): number {
  if (count <= 3) return 0;
  return count <= 8 ? 1 : 2;
}

function compareRequired(
  history: readonly CiTimingAttempt[],
  required: readonly CiWorkflow[],
): { exact: CiTimingAttempt[]; sizeBand: CiTimingAttempt[] } {
  const names = new Set(required.map((workflow) => workflow.name));
  const size = workflowCountBand(names.size);
  return {
    exact: history.filter(
      ({ requiredWorkflows }) =>
        requiredWorkflows !== null &&
        requiredWorkflows.length === names.size &&
        requiredWorkflows.every((name) => names.has(name)),
    ),
    sizeBand: history.filter(
      ({ requiredWorkflows }) =>
        requiredWorkflows !== null &&
        requiredWorkflows.length > 0 &&
        workflowCountBand(requiredWorkflows.length) === size,
    ),
  };
}

function cohortRange(
  cohorts: ReturnType<typeof compareRequired>,
  measure: "turnaroundSeconds" | "gateTailSeconds",
  start: number,
  asOf: number,
): TimeRange | null {
  const durations = (attempts: readonly CiTimingAttempt[]) =>
    attempts.flatMap((attempt) =>
      attempt[measure] === null ? [] : [attempt[measure]],
    );
  return (
    conditionalRange(durations(cohorts.exact), start, asOf) ??
    conditionalRange(durations(cohorts.sizeBand), start, asOf)
  );
}

function prerequisiteFinish(
  required: readonly CiWorkflow[],
  running: ReadonlyMap<string, TimeRange>,
): TimeRange | null {
  const ranges: TimeRange[] = [];
  for (const workflow of required) {
    if (workflow.state === "success" && workflow.finishedAt !== null) {
      const actual = Date.parse(workflow.finishedAt);
      ranges.push({ earliest: actual, latest: actual });
      continue;
    }
    const range = running.get(workflow.id);
    if (range === undefined) return null;
    ranges.push(range);
  }
  return {
    earliest: Math.max(...ranges.map((range) => range.earliest)),
    latest: Math.max(...ranges.map((range) => range.latest)),
  };
}

function prEstimate(
  run: CiRun,
  history: readonly CiTimingAttempt[],
  running: ReadonlyMap<string, TimeRange>,
  asOf: number,
): CiEstimate | null {
  const gate = workflowNamed(run, COMPLETION_WORKFLOW);
  const required = prerequisites(run);
  if (
    gate === undefined ||
    required === null ||
    run.pr === null ||
    !ACTIVE_WORKFLOW_STATES.has(gate.state) ||
    required.some(
      (workflow) =>
        workflow.state !== "success" &&
        !ACTIVE_WORKFLOW_STATES.has(workflow.state),
    )
  )
    return null;

  if (gate.state === "running") {
    const finish = running.get(gate.id);
    return finish === undefined ? null : estimate("running", finish);
  }

  const cohorts = compareRequired(history, required);
  const last = prerequisiteFinish(required, running);
  if (last !== null) {
    const early = cohortRange(cohorts, "gateTailSeconds", last.earliest, asOf);
    const late = cohortRange(cohorts, "gateTailSeconds", last.latest, asOf);
    if (early !== null && late !== null) {
      return estimate("refined", {
        earliest: early.earliest,
        latest: Math.max(early.earliest, late.latest),
      });
    }
  }

  const rough = cohortRange(
    cohorts,
    "turnaroundSeconds",
    Date.parse(run.createdAt),
    asOf,
  );
  return rough === null ? null : estimate("rough", rough);
}

export function estimateCiDashboard(
  sample: CiDashboardSample,
  history: CiTimingHistory | null,
  now: Date,
): CiEstimates {
  const estimates: CiEstimates = { runs: {}, workflows: {} };
  const { queue, jobs } = sample;
  if (
    history === null ||
    queue === null ||
    jobs === null ||
    queue.paused ||
    isCiSampleStale(jobs.sampledAt, now) ||
    isCiSampleStale(queue.sampledAt, now) ||
    now.getTime() - Date.parse(history.sampledAt) >= TIMINGS_STALE_AFTER_MS
  )
    return estimates;

  const asOf = Date.parse(jobs.sampledAt);
  const recent = history.attempts.filter(
    (entry) => Date.parse(entry.finishedAt) >= asOf - CI_TIMING_HISTORY_MS,
  );
  for (const run of jobs.active) {
    if (!ACTIVE_RUN_STATES.has(run.state) || run.finishedAt !== null) continue;
    const comparable = recent.filter(
      (entry) =>
        entry.event === run.event &&
        (entry.pipeline !== run.pipeline || entry.attempt !== run.attempt),
    );
    const running = new Map<string, TimeRange>();
    for (const workflow of run.workflows) {
      const range = workflowFinish(workflow, comparable, asOf);
      if (range === null) continue;
      running.set(workflow.id, range);
      estimates.workflows[ciWorkflowKey(run, workflow)] = estimate(
        "running",
        range,
      );
    }
    const range = prEstimate(run, comparable, running, asOf);
    if (range !== null) estimates.runs[ciRunKey(run)] = range;
  }
  return estimates;
}
