import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { FleetEnvironment, FleetObserver, WorkerRunner } from "./ports.ts";
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
import { createWorkerTools } from "./tools.ts";

const MASTER_INSTRUCTIONS = `You are the conversational master for a deterministic PR fleet controller.
Use only the provided control-plane tools. Never claim a state you have not obtained
from fleet_status. You may change priority, pause/resume work, queue worker guidance,
or request a tick. Never weaken readiness, merge, close, or approve a PR.`;

const WORKER_INSTRUCTIONS = `You own one focused fix cycle for exactly one PR.
Refresh evidence first, choose one actionable blocker, preserve the PR's intent, and
use only the assigned worktree tools. Never merge, close, approve, suppress a gate,
use blanket staging, or bypass hooks. Return the required structured result after one
cycle; do not poll or sleep.`;

export class MastraWorkerRunner implements WorkerRunner {
  readonly #model: MastraModelConfig;
  readonly #store: FleetStore;
  readonly #environment: FleetEnvironment;
  readonly #extraSecretNames: readonly string[];

  constructor(
    model: MastraModelConfig,
    store: FleetStore,
    environment: FleetEnvironment,
    // The operator's configured `--api-key-env` var name (if any), scrubbed from
    // every validation/setup subprocess in addition to the credential heuristic.
    extraSecretNames: readonly string[] = [],
  ) {
    this.#model = model;
    this.#store = store;
    this.#environment = environment;
    this.#extraSecretNames = extraSecretNames;
  }

  async run(pr: PrState, signal: AbortSignal): Promise<WorkerResult> {
    const guidance = this.#store.takeGuidance(pr.identity.number);
    const prNumber = String(pr.identity.number);
    const generation = String(pr.agentGeneration);
    const agent = new Agent({
      id: `pr-${prNumber}-g${generation}`,
      name: `PR ${prNumber} worker`,
      instructions: WORKER_INSTRUCTIONS,
      model: this.#model,
      tools: createWorkerTools(pr, this.#store, this.#environment, {
        signal,
        extraSecretNames: this.#extraSecretNames,
      }),
    });
    const prompt = `Work one cycle on PR #${prNumber}.
Current state: ${JSON.stringify(pr)}
Additional user guidance: ${guidance.length === 0 ? "none" : guidance.join("\n")}`;

    let firstError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await agent.generate(
          attempt === 0
            ? prompt
            : `${prompt}\nThe prior response failed schema validation. Return every required field.`,
          {
            abortSignal: signal,
            maxSteps: 20,
            structuredOutput: {
              schema: WorkerResultSchema,
              jsonPromptInjection: "auto",
              errorStrategy: "strict",
            },
          },
        );
        return WorkerResultSchema.parse(result.object);
      } catch (error) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        firstError ??= normalized;
      }
    }
    throw firstError ?? new Error("Worker failed without an error");
  }
}

/** The minimal shape of a streamed master turn the drain loop consumes. */
type MasterTurnStream = { textStream: AsyncIterable<string> };

export class MastraMaster {
  readonly #agent: Agent;
  readonly #observer: FleetObserver;
  readonly #history: string[] = [];
  readonly #queue: string[] = [];
  readonly #abort = new AbortController();
  #drain: Promise<void> | null = null;
  #stopped = false;

  constructor(
    model: MastraModelConfig,
    controller: MasterControllerTools,
    observer: FleetObserver,
  ) {
    this.#observer = observer;
    this.#agent = new Agent({
      id: "pr-fleet-master",
      name: "PR fleet master",
      instructions: MASTER_INSTRUCTIONS,
      model,
      tools: createMasterTools(controller),
    });
  }

  send(message: string): void {
    // After shutdown, drop steering rather than starting a fresh remote turn.
    if (this.#stopped) {
      return;
    }
    this.#queue.push(message);
    this.#drain ??= this.#runDrain();
  }

  // Stream one master turn's text. A protected seam so tests can drive the
  // shutdown lifecycle without a live model; production threads the abort signal
  // into the model call so a shutdown actually cancels the remote turn.
  protected streamTurn(
    prompt: string,
    signal: AbortSignal,
  ): Promise<MasterTurnStream> {
    return this.#agent.stream(prompt, { maxSteps: 12, abortSignal: signal });
  }

  async #runDrain(): Promise<void> {
    try {
      while (this.#queue.length > 0 && !this.#abort.signal.aborted) {
        const queued = this.#queue.splice(0);
        const prompt = [
          "Conversation so far:",
          ...this.#history.slice(-20),
          "New user messages:",
          ...queued.map((item) => `user: ${item}`),
        ].join("\n");
        const output = await this.streamTurn(prompt, this.#abort.signal);
        let response = "";
        for await (const text of output.textStream) {
          response += text;
          this.#observer.onMasterText(text);
        }
        for (const item of queued) {
          this.#history.push(`user: ${item}`);
        }
        this.#history.push(`assistant: ${response}`);
      }
    } catch (error) {
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
