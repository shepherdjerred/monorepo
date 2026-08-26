import {
  EXPLORE_TIMEOUT_MS,
  ExploreRunSnapshotEventSchema,
  type DiscordAccountId,
  type ExploreActiveRun,
  type ExploreRunOutcome,
  type ExploreTraceEntry,
  type ExploreTurnRequest,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import {
  ExploreConversationBusyError,
  tryStartExploreTurn,
  waitForExploreConversation,
  type ExploreRateLimitRejection,
  type ExploreRateLimitIdentity,
} from "#src/explore/rate-limit.ts";
import {
  ExploreNotFoundError,
  deleteExploreConversation,
  loadExploreTranscript,
} from "#src/explore/store.ts";
import type { ExploreInvalidTurnError } from "#src/explore/store.ts";
import { scoutExploreTurnsTotal } from "#src/metrics/explore.ts";
import { temporalInteractiveEnabled } from "#src/config/dynamic.ts";
import {
  DurableExploreUnavailableError,
  durableExploreOutcome,
  listDurableExploreRuns,
  requestDurableExploreStop,
  subscribeDurableExploreRun,
  waitForDurableExploreRun,
} from "#src/explore/durable-runs.ts";
import {
  createDeferred,
  executeActiveExploreRun,
} from "#src/explore/run-manager-helpers.ts";
import { startExploreRun } from "#src/explore/run-manager-start.ts";
import type {
  ActiveRun,
  ExploreAgentRunner,
  RunTermination,
  Subscriber,
  StartedTurn,
  TerminalRun,
} from "#src/explore/run-manager-types.ts";
import type { ExploreRateLimitTicket } from "#src/explore/rate-limit.ts";
import {
  broadcastExploreEvent,
  recordExploreEvent,
} from "#src/explore/run-events.ts";

const TERMINAL_OUTCOME_TTL_MS = 5 * 60 * 1000;
export class ExploreRunUnavailableError extends Error {}
export class ExploreRunRateLimitedError extends Error {
  readonly rejection: ExploreRateLimitRejection;

  constructor(rejection: ExploreRateLimitRejection) {
    super(rejection.reason);
    this.rejection = rejection;
  }
}

export type ExploreRunStartError =
  | ExploreConversationBusyError
  | ExploreRunUnavailableError
  | ExploreRunRateLimitedError
  | ExploreInvalidTurnError
  | ExploreNotFoundError;

/**
 * Owns Explore work independently of any one browser response.
 *
 * Temporal owns durable execution. This manager owns only the Activity's live
 * provider stream and in-process SSE subscribers; persisted snapshots and
 * terminal outcomes let reconnecting clients recover across a deploy.
 */
export class ExploreRunManager {
  readonly #client: ExtendedPrismaClient;
  readonly #runAgent: ExploreAgentRunner;
  readonly #timeoutMs: number;
  readonly #inlineExecutionForTests: boolean;
  readonly #runs = new Map<string, ActiveRun>();
  readonly #conversationRuns = new Map<string, string>();
  readonly #startingConversations = new Map<string, Promise<null>>();
  readonly #deletingConversations = new Set<string>();
  readonly #terminalRuns = new Map<string, TerminalRun>();
  #acceptingRuns = true;

  constructor(
    dependencies: {
      client?: ExtendedPrismaClient;
      runAgent?: ExploreAgentRunner;
      timeoutMs?: number;
      inlineExecutionForTests?: boolean;
    } = {},
  ) {
    this.#client = dependencies.client ?? prisma;
    this.#runAgent = dependencies.runAgent ?? streamExploreAgent;
    this.#timeoutMs = dependencies.timeoutMs ?? EXPLORE_TIMEOUT_MS;
    this.#inlineExecutionForTests =
      dependencies.inlineExecutionForTests ?? false;
  }

  async start(
    identity: ExploreRateLimitIdentity,
    request: ExploreTurnRequest,
    guildIds: string[],
  ): Promise<ExploreActiveRun> {
    this.#assertAcceptingRuns();
    const conversationId =
      request.conversationId ?? globalThis.crypto.randomUUID();
    if (
      this.#conversationRuns.has(conversationId) ||
      this.#startingConversations.has(conversationId) ||
      this.#deletingConversations.has(conversationId)
    ) {
      throw new ExploreConversationBusyError(
        "This conversation already has an answer running.",
      );
    }

    const ticket = tryStartExploreTurn(identity, Date.now());
    if (!ticket.allowed) {
      scoutExploreTurnsTotal.inc({ status: "rate_limited" });
      throw new ExploreRunRateLimitedError(ticket);
    }
    if (!ticket.claimConversation(conversationId)) {
      ticket.finish();
      throw new ExploreConversationBusyError(
        "This conversation already has an answer running.",
      );
    }
    const starting = createDeferred();
    this.#startingConversations.set(conversationId, starting.promise);

    try {
      return await startExploreRun({
        client: this.#client,
        identity,
        request,
        guildIds,
        conversationId,
        ticket,
        inlineExecutionForTests:
          this.#inlineExecutionForTests || !temporalInteractiveEnabled(),
        assertAcceptingRuns: () => {
          this.#assertAcceptingRuns();
        },
        registerRun: (run) => {
          this.#runs.set(run.summary.runId, run);
          this.#conversationRuns.set(
            run.summary.conversationId,
            run.summary.runId,
          );
        },
        removeRun: (summary) => {
          this.#runs.delete(summary.runId);
          this.#conversationRuns.delete(summary.conversationId);
        },
        executeInline: (run) => {
          void this.#execute(run);
        },
        clearStartingConversation: () => {
          this.#startingConversations.delete(conversationId);
        },
        createRateLimitedError: (rejection) =>
          new ExploreRunRateLimitedError(rejection),
        isDurableUnavailable: (error) =>
          error instanceof DurableExploreUnavailableError,
        isRateLimited: (error) => error instanceof ExploreRunRateLimitedError,
        createUnavailableError: (error) =>
          new ExploreRunUnavailableError(
            "Temporal is unavailable. Try again after it reconnects.",
            { cause: error },
          ),
      });
    } catch (error) {
      ticket.finish();
      throw error;
    } finally {
      this.#startingConversations.delete(conversationId);
      starting.resolve(null);
    }
  }

  list(userId: DiscordAccountId): ExploreActiveRun[] {
    return [...this.#runs.values()]
      .filter((run) => run.identity.userId === userId)
      .map((run) => run.summary)
      .toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async listDurable(userId: DiscordAccountId): Promise<ExploreActiveRun[]> {
    const local = this.list(userId);
    if (this.#inlineExecutionForTests || !temporalInteractiveEnabled()) {
      return local;
    }
    return await listDurableExploreRuns(this.#client, userId, local);
  }

  subscribe(
    runId: string,
    userId: DiscordAccountId,
    subscriber: Subscriber,
  ): (() => void) | null {
    const run = this.#runs.get(runId);
    if (run?.identity.userId !== userId) {
      return null;
    }
    subscriber(
      ExploreRunSnapshotEventSchema.parse({
        type: "snapshot",
        ...run.summary,
        answer: run.answer.length === 0 ? null : run.answer,
        activity: run.activity,
        trace: run.trace,
      }),
    );
    run.subscribers.add(subscriber);
    return () => {
      run.subscribers.delete(subscriber);
    };
  }

  async subscribeDurable(
    runId: string,
    userId: DiscordAccountId,
    subscriber: Subscriber,
  ): Promise<(() => void) | null> {
    const local = this.subscribe(runId, userId, subscriber);
    if (
      local !== null ||
      this.#inlineExecutionForTests ||
      !temporalInteractiveEnabled()
    ) {
      return local;
    }
    return await subscribeDurableExploreRun(
      this.#client,
      runId,
      userId,
      subscriber,
    );
  }

  async stop(runId: string, userId: DiscordAccountId): Promise<boolean> {
    if (this.#inlineExecutionForTests || !temporalInteractiveEnabled()) {
      const run = this.#runs.get(runId);
      if (run?.identity.userId !== userId) return false;
      this.#abort(run, "stop", "Explore turn stopped by the asker.");
      return true;
    }
    return await requestDurableExploreStop(this.#client, runId, userId);
  }

  snapshot(
    runId: string,
  ): { answer: string; trace: ExploreTraceEntry[] } | undefined {
    const run = this.#runs.get(runId);
    return run === undefined
      ? undefined
      : { answer: run.answer, trace: run.trace };
  }

  cancelTemporal(runId: string, message: string): void {
    const run = this.#runs.get(runId);
    if (run !== undefined) this.#abort(run, "stop", message);
  }

  async rehydrateTemporalRun(input: {
    summary: ExploreActiveRun;
    identity: ExploreRateLimitIdentity;
    guildIds: string[];
    started: StartedTurn;
  }): Promise<void> {
    if (this.#runs.has(input.summary.runId)) return;
    const existingRunId = this.#conversationRuns.get(
      input.summary.conversationId,
    );
    if (existingRunId !== undefined && existingRunId !== input.summary.runId) {
      throw new ExploreConversationBusyError(
        "This conversation already has an answer running.",
      );
    }
    const transcript = await loadExploreTranscript(
      this.#client,
      input.summary.conversationId,
      input.identity.userId,
      input.started.messageId,
    );
    if (transcript === null) {
      throw new ExploreNotFoundError("Conversation not found.");
    }
    const ticket: ExploreRateLimitTicket = {
      allowed: true,
      runId: input.summary.runId,
      claimConversation: () => true,
      commit: () => {
        // Rehydrated runs do not own a new quota reservation.
      },
      finish: () => {
        // Rehydrated runs do not own a new quota reservation.
      },
    };
    const deferred = createDeferred();
    const run: ActiveRun = {
      summary: input.summary,
      identity: input.identity,
      guildIds: input.guildIds,
      ticket,
      started: input.started,
      history: transcript.messages,
      abortController: new AbortController(),
      subscribers: new Set(),
      answer: "",
      activity: "Thinking…",
      trace: [],
      termination: null,
      settled: deferred.promise,
      resolveSettled: deferred.resolve,
    };
    this.#runs.set(run.summary.runId, run);
    this.#conversationRuns.set(run.summary.conversationId, run.summary.runId);
  }

  async executeTemporal(runId: string): Promise<ExploreRunOutcome> {
    const run = this.#runs.get(runId);
    if (run === undefined) {
      throw new ExploreRunUnavailableError(
        `Explore run ${runId} is not active in this process`,
      );
    }
    return await this.#execute(run);
  }

  outcome(runId: string, userId: DiscordAccountId): ExploreRunOutcome | null {
    const terminal = this.#terminalRuns.get(runId);
    if (terminal?.userId !== userId) return null;
    if (Date.now() - terminal.completedAt > TERMINAL_OUTCOME_TTL_MS) {
      this.#terminalRuns.delete(runId);
      return null;
    }
    return terminal.outcome;
  }

  async durableOutcome(
    runId: string,
    userId: DiscordAccountId,
  ): Promise<ExploreRunOutcome | null> {
    const local = this.outcome(runId, userId);
    if (
      local !== null ||
      this.#inlineExecutionForTests ||
      !temporalInteractiveEnabled()
    ) {
      return local;
    }
    return await durableExploreOutcome(this.#client, runId, userId);
  }

  async deleteConversationAndWait(
    conversationId: string,
    userId: DiscordAccountId,
  ): Promise<boolean> {
    const owned = await this.#client.exploreConversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (owned === null) return false;

    if (this.#deletingConversations.has(conversationId)) {
      throw new ExploreConversationBusyError(
        "This conversation is already being deleted.",
      );
    }
    this.#deletingConversations.add(conversationId);
    try {
      await this.#startingConversations.get(conversationId);
      const runId = this.#conversationRuns.get(conversationId);
      const run = runId === undefined ? undefined : this.#runs.get(runId);
      if (run?.identity.userId === userId) {
        if (this.#inlineExecutionForTests || !temporalInteractiveEnabled()) {
          this.#abort(
            run,
            "delete",
            "Explore conversation deleted by the asker.",
          );
          await run.settled;
        } else {
          await this.stop(run.summary.runId, userId);
          await this.#waitForDurableRun(run.summary.runId);
        }
      } else {
        if (this.#inlineExecutionForTests || !temporalInteractiveEnabled()) {
          await waitForExploreConversation(conversationId);
          return await deleteExploreConversation(
            this.#client,
            conversationId,
            userId,
          );
        }
        const durableRun = await this.#client.scoutInteractiveRun.findFirst({
          where: {
            kind: "explore",
            ownerId: userId,
            conversationId,
            state: { in: ["PENDING", "RUNNING"] },
          },
          select: { id: true },
        });
        if (durableRun !== null) {
          await this.stop(durableRun.id, userId);
          await this.#waitForDurableRun(durableRun.id);
        }
      }
      return await deleteExploreConversation(
        this.#client,
        conversationId,
        userId,
      );
    } finally {
      this.#deletingConversations.delete(conversationId);
    }
  }

  async shutdown(): Promise<void> {
    this.#acceptingRuns = false;
    await Promise.all(this.#startingConversations.values());
    const runs = [...this.#runs.values()];
    for (const run of runs) {
      this.#abort(run, "shutdown", "Explore backend is shutting down.");
    }
    await Promise.all(
      runs.map(async (run) => {
        await run.settled;
      }),
    );
  }

  resetForTests(): void {
    if (
      this.#runs.size > 0 ||
      this.#startingConversations.size > 0 ||
      this.#deletingConversations.size > 0
    ) {
      throw new Error(
        "Cannot reset Explore run manager while runs are active.",
      );
    }
    this.#conversationRuns.clear();
    this.#terminalRuns.clear();
    this.#acceptingRuns = true;
  }

  #assertAcceptingRuns(): void {
    if (!this.#acceptingRuns) {
      throw new ExploreRunUnavailableError(
        "Explore is shutting down. Try again after it reconnects.",
      );
    }
  }

  async #waitForDurableRun(runId: string): Promise<void> {
    try {
      await waitForDurableExploreRun(this.#client, runId, this.#timeoutMs);
    } catch (error) {
      throw new ExploreRunUnavailableError(
        "Explore did not finish cancellation before the delete deadline.",
        { cause: error },
      );
    }
  }

  #abort(
    run: ActiveRun,
    reason: Exclude<RunTermination, null>,
    message: string,
  ) {
    if (run.termination !== null) {
      return;
    }
    run.termination = reason;
    run.activity = reason === "stop" ? "Stopping…" : run.activity;
    run.abortController.abort(message);
  }

  async #execute(run: ActiveRun): Promise<ExploreRunOutcome> {
    const outcome = await executeActiveExploreRun({
      run,
      client: this.#client,
      runAgent: this.#runAgent,
      timeoutMs: this.#timeoutMs,
      record: (event) => {
        recordExploreEvent(run, event);
      },
    });
    try {
      return outcome;
    } finally {
      this.#recordTerminalOutcome(run, outcome);
      broadcastExploreEvent(run, { type: "done", outcome });
      run.subscribers.clear();
      this.#runs.delete(run.summary.runId);
      this.#conversationRuns.delete(run.summary.conversationId);
      run.resolveSettled(null);
    }
  }

  #recordTerminalOutcome(run: ActiveRun, outcome: ExploreRunOutcome): void {
    const completedAt = Date.now();
    for (const [runId, terminal] of this.#terminalRuns) {
      if (completedAt - terminal.completedAt > TERMINAL_OUTCOME_TTL_MS) {
        this.#terminalRuns.delete(runId);
      }
    }
    this.#terminalRuns.set(run.summary.runId, {
      userId: run.identity.userId,
      outcome,
      completedAt,
    });
  }
}
export const exploreRunManager = new ExploreRunManager();
