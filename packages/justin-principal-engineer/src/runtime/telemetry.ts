import { appendFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  TaskPhaseSchema,
  TaskStateSchema,
  type TaskState,
} from "#src/domain/schemas.ts";
import type { AgentProgress } from "#src/agent/progress.ts";
import {
  exportMetrics,
  type ExportMetrics,
  type MetricSample,
} from "./metric-export.ts";
import type { RuntimePaths } from "./paths.ts";

const Count = z.number().int().nonnegative();
const Outcome = z.enum(["success", "failure"]);
const TokenKind = z.enum(["input", "output", "cached_input"]);
const PassReason = TaskStateSchema.shape.lastPass.unwrap().shape.reason;
type Outcome = z.infer<typeof Outcome>;
type Phase = TaskState["phase"];
type Decision =
  | "at_capacity"
  | "empty"
  | "awaiting_ci"
  | "awaiting_approval"
  | "candidate_selected"
  | "external_block";
const TotalsSchema = z.object({
  startedAt: Count,
  lastReconcile: Count.default(0),
  lastSuccess: Count.default(0),
  consecutiveFailures: Count.default(0),
  openPrs: Count.default(0),
  eligible: Count.default(0),
  staleBaseRestacks: Count.default(0),
  reconciles: z.partialRecord(Outcome, Count).default({}),
  transitions: z.partialRecord(TaskPhaseSchema, Count).default({}),
  passes: z.partialRecord(PassReason, Count).default({}),
  stageDuration: z
    .partialRecord(
      TaskPhaseSchema,
      z.object({
        seconds: z.number().nonnegative(),
        success: Count,
        failure: Count,
      }),
    )
    .default({}),
  tokens: z.partialRecord(TokenKind, Count).default({}),
});
const LOG_BYTES = 1024 * 1024;
const RECONCILE_TIMEOUT_MS = 5 * 60_000;

export function telemetryLogPath(paths: RuntimePaths): string {
  return path.join(paths.logs, "events.ndjson");
}

function taskFields(state: TaskState) {
  return {
    issue: /^[A-Z][A-Z0-9]*-[1-9]\d*$/.test(state.issue.identifier)
      ? state.issue.identifier
      : null,
    pr: state.prNumber,
    head: /^[a-f0-9]{40}$/.test(state.latestHeadSha ?? "")
      ? state.latestHeadSha
      : null,
    repairs: state.repairTurnsUsed,
  };
}

function timestampSamples(
  totals: z.infer<typeof TotalsSchema>,
  deadline: number,
) {
  return [
    {
      name: "justin_reconcile_last_started_timestamp_seconds",
      value: totals.lastReconcile / 1000,
    },
    {
      name: "justin_reconcile_last_success_timestamp_seconds",
      value: totals.lastSuccess / 1000,
    },
    { name: "justin_stage_deadline_timestamp_seconds", value: deadline / 1000 },
    { name: "justin_consecutive_failures", value: totals.consecutiveFailures },
    { name: "justin_queue_eligible", value: totals.eligible },
    { name: "justin_open_pull_requests", value: totals.openPrs },
  ];
}

function taskSamples(
  states: readonly TaskState[],
  now: number,
): MetricSample[] {
  const byPhase = Map.groupBy(states, ({ phase }) => phase);
  return TaskPhaseSchema.options.flatMap((phase) => {
    const tasks = byPhase.get(phase) ?? [];
    const oldestWait = tasks.reduce(
      (oldest, task) =>
        Math.max(oldest, (now - Date.parse(task.updatedAt)) / 1000),
      0,
    );
    return [
      { name: "justin_tasks", value: tasks.length, labels: { phase } },
      {
        name: "justin_oldest_wait_seconds",
        value: oldestWait,
        labels: { phase },
      },
    ];
  });
}

export class JustinTelemetry {
  private readonly totalsPath: string;
  private totals = TotalsSchema.parse({ startedAt: Date.now() });
  private initialPhases: ReadonlyMap<string, Phase> | null = null;
  private states: readonly TaskState[] | null = null;
  private running: TaskState | null = null;
  private deadline = 0;
  private reconcileId = "";
  private logFailed = false;
  private logWrites: Promise<void> = Promise.resolve();
  private ledgerReady = false;

  public constructor(
    private readonly paths: RuntimePaths,
    private readonly turnTimeoutMinutes: number,
    private readonly send: ExportMetrics = exportMetrics,
  ) {
    this.totalsPath = path.join(paths.root, "telemetry.json");
  }

  public async begin(): Promise<void> {
    this.reconcileId = crypto.randomUUID();
    this.running = null;
    this.initialPhases = null;
    this.states = null;
    const file = Bun.file(this.totalsPath);
    try {
      if (await file.exists()) {
        this.totals = TotalsSchema.parse(await file.json());
      }
      this.ledgerReady = true;
    } catch {
      this.ledgerReady = false;
      this.log("telemetry_ledger_error");
    }
    this.totals.lastReconcile = Date.now();
    this.deadline = this.totals.lastReconcile + RECONCILE_TIMEOUT_MS;
    this.log("reconcile_started");
    await this.flush();
  }

  public snapshot(states: readonly TaskState[]): void {
    this.states = states;
    this.initialPhases = new Map(
      states.map((state) => [state.issue.identifier, state.phase]),
    );
  }

  public queue(counts: { eligible?: number; openPrs?: number }): void {
    if (counts.eligible !== undefined) this.totals.eligible = counts.eligible;
    if (counts.openPrs !== undefined) this.totals.openPrs = counts.openPrs;
    this.log("queue_observed", counts);
  }

  public decision(reason: Decision, state?: TaskState): void {
    this.log("queue_decision", {
      reason,
      ...(state === undefined ? {} : taskFields(state)),
    });
  }

  public staleBaseRestack(
    state: TaskState,
    details: {
      mergeBaseSha: string;
      mainHeadSha: string;
      behindBy: number;
      restackedHeadSha: string | null;
      conflict: boolean;
    },
  ): void {
    this.totals.staleBaseRestacks += 1;
    this.log("stale_base_restack", {
      ...taskFields(state),
      mergeBase: /^[a-f0-9]{40}$/.test(details.mergeBaseSha)
        ? details.mergeBaseSha
        : null,
      mainHead: /^[a-f0-9]{40}$/.test(details.mainHeadSha)
        ? details.mainHeadSha
        : null,
      behindBy: details.behindBy,
      restackedHead:
        details.restackedHeadSha !== null &&
        /^[a-f0-9]{40}$/.test(details.restackedHeadSha)
          ? details.restackedHeadSha
          : null,
      conflict: details.conflict,
    });
  }

  public async stage<T>(
    phase: Phase,
    state: TaskState,
    work: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    this.running = state;
    const longStage = phase === "implementing" || phase === "publishing";
    const stageBudget = longStage
      ? (this.turnTimeoutMinutes + 25) * 60_000
      : RECONCILE_TIMEOUT_MS;
    this.deadline = started + stageBudget;
    this.log("stage_started", { phase, ...taskFields(state) });
    await this.flush();
    let outcome: Outcome = "failure";
    try {
      const result = await work();
      outcome = "success";
      return result;
    } finally {
      const seconds = Math.max(0, Date.now() - started) / 1000;
      const stats = this.totals.stageDuration[phase] ?? {
        seconds: 0,
        success: 0,
        failure: 0,
      };
      stats.seconds += seconds;
      stats[outcome] += 1;
      this.totals.stageDuration[phase] = stats;
      this.running = null;
      this.log("stage_finished", {
        phase,
        outcome,
        seconds,
        ...taskFields(state),
      });
    }
  }

  public progress(progress: AgentProgress): void {
    if (progress.kind === "turn_completed") {
      for (const tokenKind of TokenKind.options) {
        this.totals.tokens[tokenKind] =
          (this.totals.tokens[tokenKind] ?? 0) + progress.usage[tokenKind];
      }
    }
    this.log("codex_progress", {
      ...progress,
      ...(this.running === null ? {} : taskFields(this.running)),
    });
  }

  public async finish(
    outcome: Outcome,
    states: readonly TaskState[],
  ): Promise<void> {
    this.states = states;
    if (this.initialPhases !== null)
      this.recordTransitions(this.initialPhases, states);
    this.totals.reconciles[outcome] =
      (this.totals.reconciles[outcome] ?? 0) + 1;
    if (outcome === "success") {
      this.totals.lastSuccess = Date.now();
      this.totals.consecutiveFailures = 0;
    } else {
      this.totals.consecutiveFailures += 1;
    }
    this.deadline = 0;
    this.log("reconcile_finished", { outcome });
    await this.flush();
  }

  private recordTransitions(
    initialPhases: ReadonlyMap<string, Phase>,
    states: readonly TaskState[],
  ) {
    for (const state of states) {
      const previous = initialPhases.get(state.issue.identifier) ?? null;
      if (previous === state.phase) continue;
      this.totals.transitions[state.phase] =
        (this.totals.transitions[state.phase] ?? 0) + 1;
      const passReason =
        state.phase === "passed" ? state.lastPass?.reason : undefined;
      if (passReason !== undefined) {
        this.totals.passes[passReason] =
          (this.totals.passes[passReason] ?? 0) + 1;
      }
      this.log("task_transition", {
        previous,
        phase: state.phase,
        passReason,
        ...taskFields(state),
      });
    }
  }

  private log(event: string, fields: object = {}): void {
    const file = telemetryLogPath(this.paths);
    const line =
      JSON.stringify({
        time: new Date().toISOString(),
        reconcileId: this.reconcileId,
        event,
        ...fields,
      }) + "\n";
    this.logWrites = this.appendEvent(this.logWrites, file, line);
  }

  private async appendEvent(
    previous: Promise<void>,
    file: string,
    line: string,
  ) {
    try {
      await previous;
      const log = Bun.file(file);
      if ((await log.exists()) && log.size >= LOG_BYTES) {
        await rename(file, file + ".1");
      }
      await appendFile(file, line, { mode: 0o600 });
    } catch {
      if (!this.logFailed)
        console.error("Justin could not write its private event log");
      this.logFailed = true;
    }
  }

  private metrics(now: number): MetricSample[] {
    const samples: MetricSample[] = timestampSamples(
      this.totals,
      this.deadline,
    );
    if (this.states !== null) samples.push(...taskSamples(this.states, now));
    for (const phase of TaskPhaseSchema.options) {
      samples.push({
        name: "justin_task_transitions_total",
        value: this.totals.transitions[phase] ?? 0,
        labels: { phase },
        cumulative: true,
      });
      const stats = this.totals.stageDuration[phase];
      if (stats === undefined) continue;
      samples.push({
        name: "justin_stage_elapsed_seconds_total",
        value: stats.seconds,
        labels: { phase },
        cumulative: true,
      });
      for (const outcome of Outcome.options) {
        samples.push({
          name: "justin_stages_total",
          value: stats[outcome],
          labels: { phase, outcome },
          cumulative: true,
        });
      }
    }
    for (const outcome of Outcome.options) {
      samples.push({
        name: "justin_reconciles_total",
        value: this.totals.reconciles[outcome] ?? 0,
        labels: { outcome },
        cumulative: true,
      });
    }
    for (const kind of TokenKind.options) {
      samples.push({
        name: "justin_codex_tokens_total",
        value: this.totals.tokens[kind] ?? 0,
        labels: { kind },
        cumulative: true,
      });
    }
    for (const reason of PassReason.options) {
      samples.push({
        name: "justin_passes_total",
        value: this.totals.passes[reason] ?? 0,
        labels: { reason },
        cumulative: true,
      });
    }
    samples.push({
      name: "justin_stale_base_restacks_total",
      value: this.totals.staleBaseRestacks,
      cumulative: true,
    });
    return samples;
  }

  private async flush(): Promise<void> {
    await this.logWrites;
    if (!this.ledgerReady) return;
    try {
      const temporary = this.totalsPath + ".tmp";
      await Bun.write(temporary, JSON.stringify(this.totals));
      await rename(temporary, this.totalsPath);
    } catch {
      this.log("telemetry_ledger_error");
      await this.logWrites;
      return;
    }
    try {
      const now = Date.now();
      await this.send(this.metrics(now), this.totals.startedAt, now);
    } catch {
      this.log("telemetry_export_failed");
      await this.logWrites;
    }
  }
}
