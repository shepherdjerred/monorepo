import { stepCountIs, ToolLoopAgent } from "ai";
import { generateValidatedObject } from "@shepherdjerred/llm-runtime";
import type {
  FleetEnvironment,
  FleetObserver,
  FleetTelemetry,
  WorkerRunner,
} from "./ports.ts";
import {
  createMasterTools,
  type MasterControllerTools,
} from "./master-tools.ts";
import {
  WorkerResultSchema,
  type PrState,
  type WorkerResult,
} from "./schemas.ts";
import type { FleetStore } from "./state.ts";
import type { RunEventCorrelation, RunEventKind } from "./run-events.ts";
import { createWorkerTools } from "./tools.ts";
import { runRecordedWorkerAttempt } from "./recorded-worker-attempt.ts";
import {
  captureTelemetryOperation,
  isTelemetryCaptureError,
} from "./controller-telemetry.ts";
import type { FleetModel } from "./model-resolution.ts";

const MASTER_INSTRUCTIONS = `You are the conversational master for a deterministic PR fleet controller.
Use only the provided control-plane tools. Never claim a state you have not obtained
from fleet_status. You may change priority, pause/resume work, queue worker guidance,
or request a tick. Never weaken readiness, merge, close, or approve a PR.`;

const WORKER_INSTRUCTIONS = `You own one focused fix cycle for exactly one PR.
Refresh evidence first, choose one actionable blocker, preserve the PR's intent, and
use only the assigned worktree tools. If worktreeContext reports inherited work,
inspect_worktree_wip before editing or publishing. Continue it when every path and
commit clearly fits the PR, all WIP and commit evidence is complete, and the work
can be isolated; use request_operator_input when evidence is truncated or a
material ownership, intent, or destructive-history decision remains uncertain.
After any controller mutation in an operator worktree, inspect its WIP again before
the next mutation or publication so concurrent operator edits are never assumed safe.
After requesting input, return waiting-for-answer with that request ID immediately.
Use the dedicated Git/WIP tools, never run git through run_local_command. Edit files
with str_replace (exact-match, the
default) or write_file (full contents); apply_patch is a fallback that requires a
correctly formatted unified diff. If publication reports a Prettier path, use
format_paths on only those files and retry publication in the same cycle. Never
merge, close, approve, suppress a gate, use
blanket staging, or bypass hooks. Return the required structured result after one
cycle; do not poll or sleep.`;

// Turn the tool-free finalizer result into a validated WorkerResult. Keep the
// explicit missing-object branch for fixture compatibility and legible errors.
export function coerceWorkerResult(result: {
  object?: unknown;
  text?: string;
}): WorkerResult {
  if (result.object === undefined) {
    const finalText = result.text?.trim();
    throw new Error(
      `Worker produced no structured result (the model ended its turn without emitting a WorkerResult, likely after exhausting its step budget)${
        finalText === undefined || finalText.length === 0
          ? ""
          : `. Final model text: ${finalText.slice(0, 500)}`
      }`,
    );
  }
  const parsed = WorkerResultSchema.parse(result.object);
  return parsed.operatorRequestId === undefined
    ? { ...parsed, operatorRequestId: null }
    : parsed;
}

const NOOP_TELEMETRY: FleetTelemetry = {
  runId: "unrecorded-test-run",
  newId: (prefix) => `${prefix}-unrecorded`,
  traceId: () => "0".repeat(32),
  record: () => {
    // Test seam for callers that exercise lifecycle behavior without capture.
  },
};

type WorkerRunnerOptions = {
  extraSecretNames?: readonly string[];
  telemetry?: FleetTelemetry;
};

type MasterOptions = {
  telemetry?: FleetTelemetry;
  onFatalError: (error: Error) => void;
  requestShutdown: () => void;
};

function signalIsAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export class NativeWorkerRunner implements WorkerRunner {
  readonly #model: FleetModel;
  readonly #store: FleetStore;
  readonly #environment: FleetEnvironment;
  readonly #extraSecretNames: readonly string[];
  readonly #telemetry: FleetTelemetry;

  constructor(
    model: FleetModel,
    store: FleetStore,
    environment: FleetEnvironment,
    options: WorkerRunnerOptions = {},
  ) {
    this.#model = model;
    this.#store = store;
    this.#environment = environment;
    this.#telemetry = options.telemetry ?? NOOP_TELEMETRY;
    this.#extraSecretNames = options.extraSecretNames ?? [];
  }

  async run(
    pr: PrState,
    signal: AbortSignal,
    tickId: string | undefined,
  ): Promise<WorkerResult> {
    const guidance = this.#store.takeGuidance(pr.identity.number);
    const prNumber = String(pr.identity.number);
    const generation = String(pr.agentGeneration);
    const prompt = `Work one cycle on PR #${prNumber}.
Current state: ${JSON.stringify(pr)}
Additional user guidance: ${guidance.length === 0 ? "none" : guidance.join("\n")}`;
    const modelTurnId = captureTelemetryOperation(
      "worker-turn correlation",
      () => this.#telemetry.newId("worker-turn"),
    );
    const traceId = captureTelemetryOperation("worker trace correlation", () =>
      this.#telemetry.traceId("worker", prNumber, generation, "1"),
    );
    const correlation = {
      traceId,
      ...(tickId === undefined ? {} : { tickId }),
      prNumber: pr.identity.number,
      headSha: pr.identity.headSha,
      generation: pr.agentGeneration,
      modelTurnId,
    };
    const agent = new ToolLoopAgent({
      id: `pr-${prNumber}-g${generation}`,
      instructions: WORKER_INSTRUCTIONS,
      model: this.#model.languageModel,
      tools: createWorkerTools(pr, this.#store, this.#environment, {
        signal,
        extraSecretNames: this.#extraSecretNames,
        telemetry: this.#telemetry,
        parentCorrelation: () => correlation,
      }),
      stopWhen: stepCountIs(20),
      ...this.#model.runtime.callOptions({
        workload: "pr-fleet.worker.tool-loop",
        sessionId: `${this.#telemetry.runId}:${prNumber}:${generation}`,
        traceContext: { traceId },
      }),
    });
    const outcome = await runRecordedWorkerAttempt({
      attempt: 1,
      prompt,
      telemetry: this.#telemetry,
      correlation,
      run: async () => {
        const result = await agent.generate({
          prompt,
          abortSignal: signal,
        });
        const evidenceJson = JSON.stringify(
          result.steps.map((step) => ({
            text: step.text,
            toolCalls: step.toolCalls,
            toolResults: step.toolResults,
            finishReason: step.finishReason,
          })),
        );
        const evidence =
          evidenceJson.length <= 120_000
            ? evidenceJson
            : `${evidenceJson.slice(0, 30_000)}\n...[bounded]...\n${evidenceJson.slice(-90_000)}`;
        const finalized = await generateValidatedObject(this.#model.runtime, {
          model: this.#model.id,
          schema: WorkerResultSchema,
          schemaName: "pr_fleet_worker_result",
          system:
            "Produce the final PR Fleet WorkerResult using only the recorded tool-loop evidence. Do not call tools, invent effects, or claim publication that is absent from evidence.",
          prompt: `${prompt}\n\nRecorded tool-loop evidence:\n${evidence}`,
          workload: "pr-fleet.worker.finalize",
          sessionId: `${this.#telemetry.runId}:${prNumber}:${generation}`,
          traceContext: { traceId },
          abortSignal: signal,
        });
        return coerceWorkerResult({ object: finalized.object });
      },
    });
    if (outcome.status === "completed") {
      return outcome.result;
    }
    throw outcome.error;
  }
}

/** The minimal shape of a streamed master turn the drain loop consumes. */
type MasterTurnStream = { textStream: AsyncIterable<string> };

export class FleetMaster {
  readonly #model: FleetModel;
  readonly #tools: ReturnType<typeof createMasterTools>;
  readonly #observer: FleetObserver;
  readonly #history: string[] = [];
  readonly #queue: string[] = [];
  readonly #abort = new AbortController();
  readonly #telemetry: FleetTelemetry;
  readonly #onFatalError: (error: Error) => void;
  #drain: Promise<void> | null = null;
  #stopped = false;
  #activeTurnCorrelation: RunEventCorrelation | null = null;

  constructor(
    model: FleetModel,
    controller: MasterControllerTools,
    observer: FleetObserver,
    options: MasterOptions,
  ) {
    this.#observer = observer;
    this.#model = model;
    this.#telemetry = options.telemetry ?? NOOP_TELEMETRY;
    this.#onFatalError = options.onFatalError;
    this.#tools = createMasterTools(
      controller,
      {
        telemetry: this.#telemetry,
        correlation: () => this.#activeTurnCorrelation ?? {},
      },
      options.requestShutdown,
    );
  }

  send(message: string): void {
    // After shutdown, drop steering rather than starting a fresh remote turn.
    if (this.#stopped) {
      return;
    }
    this.#queue.push(message);
    this.#drain ??= this.#runDrain();
  }

  #newId(prefix: string): string {
    return captureTelemetryOperation(`${prefix} correlation`, () =>
      this.#telemetry.newId(prefix),
    );
  }

  #traceId(...parts: string[]): string {
    return captureTelemetryOperation("master trace correlation", () =>
      this.#telemetry.traceId(...parts),
    );
  }

  #record(
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation: RunEventCorrelation,
  ): void {
    captureTelemetryOperation(kind, () => {
      this.#telemetry.record(kind, payload, correlation);
    });
  }

  #reportCaptureFailure(error: Error): void {
    this.#activeTurnCorrelation = null;
    this.#stopped = true;
    this.#abort.abort();
    this.#onFatalError(error);
  }

  // Stream one master turn's text. A protected seam so tests can drive the
  // shutdown lifecycle without a live model; production threads the abort signal
  // into the model call so a shutdown actually cancels the remote turn.
  protected streamTurn(
    prompt: string,
    signal: AbortSignal,
    traceId?: string,
  ): Promise<MasterTurnStream> {
    const agent = new ToolLoopAgent({
      id: "pr-fleet-master",
      instructions: MASTER_INSTRUCTIONS,
      model: this.#model.languageModel,
      tools: this.#tools,
      stopWhen: stepCountIs(12),
      ...this.#model.runtime.callOptions({
        workload: "pr-fleet.master",
        sessionId: this.#telemetry.runId,
        ...(traceId === undefined ? {} : { traceContext: { traceId } }),
      }),
    });
    return agent.stream({ prompt, abortSignal: signal });
  }

  async #runDrain(): Promise<void> {
    let activeResponse = "";
    try {
      while (this.#queue.length > 0 && !this.#abort.signal.aborted) {
        const queued = this.#queue.splice(0);
        const prompt = [
          "Conversation so far:",
          ...this.#history.slice(-20),
          "New user messages:",
          ...queued.map((item) => `user: ${item}`),
        ].join("\n");
        const modelTurnId = this.#newId("master-turn");
        const traceId = this.#traceId("master", modelTurnId);
        const correlation = { traceId, modelTurnId };
        this.#activeTurnCorrelation = correlation;
        activeResponse = "";
        this.#record(
          "master.turn.started",
          { prompt, messages: queued },
          correlation,
        );
        const output = await this.streamTurn(
          prompt,
          this.#abort.signal,
          traceId,
        );
        for await (const text of output.textStream) {
          activeResponse += text;
          this.#observer.onMasterText(text);
        }
        if (signalIsAborted(this.#abort.signal)) {
          this.#record(
            "master.turn.failed",
            { aborted: true, response: activeResponse },
            correlation,
          );
          this.#activeTurnCorrelation = null;
          break;
        }
        for (const item of queued) {
          this.#history.push(`user: ${item}`);
        }
        this.#history.push(`assistant: ${activeResponse}`);
        this.#record("master.text", { text: activeResponse }, correlation);
        this.#record(
          "master.turn.completed",
          { response: activeResponse },
          correlation,
        );
        this.#activeTurnCorrelation = null;
      }
    } catch (error) {
      if (isTelemetryCaptureError(error)) {
        this.#reportCaptureFailure(
          error instanceof Error ? error : new Error(String(error)),
        );
        return;
      }
      try {
        this.#record(
          "master.turn.failed",
          {
            aborted: this.#abort.signal.aborted,
            error: error instanceof Error ? error.message : String(error),
            response: activeResponse,
          },
          this.#activeTurnCorrelation ?? {},
        );
      } catch (captureError) {
        if (isTelemetryCaptureError(captureError)) {
          this.#reportCaptureFailure(
            captureError instanceof Error
              ? captureError
              : new Error(String(captureError)),
          );
          return;
        }
        throw captureError;
      }
      this.#activeTurnCorrelation = null;
      // An abort during shutdown is expected, not a failure to report.
      if (!this.#abort.signal.aborted) {
        this.#observer.onChange(
          `master turn failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      this.#drain = null;
      // A message enqueued during the final await starts a fresh drain — unless
      // we are shutting down, in which case the queue is intentionally dropped.
      if (this.#queue.length > 0 && !this.#abort.signal.aborted) {
        this.#drain = this.#runDrain();
      }
    }
  }

  // Abort any in-flight master turn AND await its settlement, so the remote
  // model turn cannot keep emitting output or invoking controller tools after
  // shutdown has been reported, nor delay process exit. Idempotent.
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#abort.abort();
    // #runDrain swallows its own errors, so awaiting it never rejects.
    while (this.#drain !== null) {
      const pending = this.#drain;
      await pending;
      if (this.#drain === pending) {
        this.#drain = null;
      }
    }
  }
}
