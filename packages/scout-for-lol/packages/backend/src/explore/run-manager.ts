import * as Sentry from "@sentry/bun";
import {
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_TIMEOUT_MS,
  ExploreActiveRunSchema,
  ExploreRunSnapshotEventSchema,
  type DiscordAccountId,
  type ExploreActiveRun,
  type ExploreMessage,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
  type ExploreTurnRequest,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  streamExploreAgent,
  type ExploreAgentParams,
  type ExploreAgentResult,
} from "#src/explore/agent.ts";
import {
  ExploreConversationBusyError,
  tryStartExploreTurn,
  waitForExploreConversation,
  type ExploreRateLimitIdentity,
  type ExploreRateLimitRejection,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import {
  ExploreInvalidTurnError,
  ExploreNotFoundError,
  deleteExploreConversation,
  loadExploreTranscript,
  resolveRegenerateTarget,
  startExploreTurn,
} from "#src/explore/store.ts";
import { recordExploreTraceEvent } from "#src/explore/trace.ts";
import { runPersistedExploreTurn } from "#src/explore/run-turn.ts";
import { createLogger } from "#src/logger.ts";
import { scoutExploreTurnsTotal } from "#src/metrics/explore.ts";

const logger = createLogger("explore-run-manager");

type RunTermination = "stop" | "delete" | "shutdown" | null;
type RunOutcome = Extract<ExploreStreamEvent, { type: "done" }>["outcome"];
type Subscriber = (event: ExploreStreamEvent) => void;
export type ExploreAgentRunner = (
  params: ExploreAgentParams,
) => Promise<ExploreAgentResult>;

type StartedTurn = {
  conversationId: string;
  title: string;
  messageId: string;
  question: string;
  expectedCurrentLeafId: string | null;
};

type ActiveRun = {
  summary: ExploreActiveRun;
  identity: ExploreRateLimitIdentity;
  ticket: ExploreRateLimitTicket;
  started: StartedTurn;
  history: ExploreMessage[];
  abortController: AbortController;
  subscribers: Set<Subscriber>;
  answer: string;
  activity: string | null;
  trace: ExploreTraceEntry[];
  termination: RunTermination;
  settled: Promise<null>;
  resolveSettled: (value: null) => void;
};

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
 * Scout currently runs one backend replica, so process-local ownership is
 * exact and intentionally avoids pretending to survive a deploy. Questions
 * and completed/partial answers remain durable in SQLite; only live execution
 * and observer state live here.
 */
export class ExploreRunManager {
  readonly #client: ExtendedPrismaClient;
  readonly #runAgent: ExploreAgentRunner;
  readonly #timeoutMs: number;
  readonly #runs = new Map<string, ActiveRun>();
  readonly #conversationRuns = new Map<string, string>();
  readonly #startingConversations = new Map<string, Promise<null>>();
  readonly #deletingConversations = new Set<string>();
  #acceptingRuns = true;

  constructor(
    dependencies: {
      client?: ExtendedPrismaClient;
      runAgent?: ExploreAgentRunner;
      timeoutMs?: number;
    } = {},
  ) {
    this.#client = dependencies.client ?? prisma;
    this.#runAgent = dependencies.runAgent ?? streamExploreAgent;
    this.#timeoutMs = dependencies.timeoutMs ?? EXPLORE_TIMEOUT_MS;
  }

  async start(
    identity: ExploreRateLimitIdentity,
    request: ExploreTurnRequest,
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
      const started = await resolveTurnTarget(
        this.#client,
        request,
        identity,
        conversationId,
      );
      const versionCountAtStart = await this.#client.exploreMessage.count({
        where: {
          conversationId: started.conversationId,
          parentId: started.messageId,
          role: "assistant",
        },
      });
      const transcript = await loadExploreTranscript(
        this.#client,
        started.conversationId,
        identity.userId,
        started.messageId,
      );
      if (transcript === null) {
        throw new ExploreNotFoundError("Conversation not found.");
      }
      this.#assertAcceptingRuns();

      const deferred = createDeferred();
      const summary = ExploreActiveRunSchema.parse({
        runId: ticket.runId,
        conversationId: started.conversationId,
        questionMessageId: started.messageId,
        leafIdAtStart: started.expectedCurrentLeafId,
        versionCountAtStart,
        startedAt: new Date().toISOString(),
      });
      const run: ActiveRun = {
        summary,
        identity,
        ticket,
        started,
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
      this.#runs.set(summary.runId, run);
      this.#conversationRuns.set(summary.conversationId, summary.runId);
      void this.#execute(run);
      return summary;
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

  stop(runId: string, userId: DiscordAccountId): boolean {
    const run = this.#runs.get(runId);
    if (run?.identity.userId !== userId) {
      return false;
    }
    this.#abort(run, "stop", "Explore turn stopped by the asker.");
    return true;
  }

  async deleteConversationAndWait(
    conversationId: string,
    userId: DiscordAccountId,
  ): Promise<boolean> {
    if (this.#deletingConversations.has(conversationId)) {
      throw new ExploreConversationBusyError(
        "This conversation is already being deleted.",
      );
    }
    this.#deletingConversations.add(conversationId);
    try {
      const owned = await this.#client.exploreConversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true },
      });
      if (owned === null) return false;

      await this.#startingConversations.get(conversationId);
      const runId = this.#conversationRuns.get(conversationId);
      const run = runId === undefined ? undefined : this.#runs.get(runId);
      if (run?.identity.userId === userId) {
        this.#abort(
          run,
          "delete",
          "Explore conversation deleted by the asker.",
        );
        await run.settled;
      } else {
        // Discord one-shot runs are outside the web observer registry, but
        // they share the process-wide conversation lease. Let one finish
        // before removing the rows it is about to persist into.
        await waitForExploreConversation(conversationId);
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
    this.#acceptingRuns = true;
  }

  #assertAcceptingRuns(): void {
    if (!this.#acceptingRuns) {
      throw new ExploreRunUnavailableError(
        "Explore is shutting down. Try again after it reconnects.",
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

  #broadcast(run: ActiveRun, event: ExploreStreamEvent): void {
    for (const subscriber of run.subscribers) {
      try {
        subscriber(event);
      } catch {
        // A subscriber is only an HTTP response. Losing it must not change the
        // model run; remove the dead observer and keep the background task.
        run.subscribers.delete(subscriber);
      }
    }
  }

  #record(run: ActiveRun, event: ExploreStreamEvent): void {
    if (
      event.type === "error" &&
      (run.termination === "stop" || run.termination === "delete")
    ) {
      return;
    }
    if (event.type === "answer_delta") {
      const available = EXPLORE_ANSWER_MAX_LENGTH - run.answer.length;
      if (available <= 0) {
        return;
      }
      const text = event.text.slice(0, available);
      run.answer += text;
      this.#broadcast(run, { type: "answer_delta", text });
      return;
    }
    if (event.type === "tool_call" || event.type === "tool_result") {
      run.activity = event.message;
    }
    recordExploreTraceEvent(run.trace, event);
    this.#broadcast(run, event);
  }

  async #execute(run: ActiveRun): Promise<void> {
    let outcome: RunOutcome = "failed";

    try {
      const result = await runPersistedExploreTurn(
        {
          ticket: run.ticket,
          identity: run.identity,
          started: run.started,
          history: run.history,
          abortSignal: run.abortController.signal,
          abortOutcome: () =>
            run.termination === "stop" || run.termination === "delete"
              ? "stopped"
              : "interrupted",
          emit: (event) => {
            this.#record(run, event);
          },
        },
        {
          client: this.#client,
          executeAgent: this.#runAgent,
          now: Date.now,
          timeoutMs: this.#timeoutMs,
        },
      );
      outcome = result.outcome;
    } catch (error) {
      logger.error(
        "Shared Explore turn runner escaped unexpectedly",
        errorMessage(error),
      );
      Sentry.captureException(error, {
        tags: { source: "explore-background-run-manager" },
      });
    } finally {
      this.#broadcast(run, { type: "done", outcome });
      run.subscribers.clear();
      this.#runs.delete(run.summary.runId);
      this.#conversationRuns.delete(run.summary.conversationId);
      run.resolveSettled(null);
    }
  }
}

async function resolveTurnTarget(
  client: ExtendedPrismaClient,
  input: ExploreTurnRequest,
  identity: ExploreRateLimitIdentity,
  newId: string,
): Promise<StartedTurn> {
  if (input.question === null) {
    if (input.conversationId === null || input.attach.kind !== "message") {
      throw new ExploreInvalidTurnError(
        "Answering again needs an existing question.",
      );
    }
    return await resolveRegenerateTarget(client, {
      conversationId: input.conversationId,
      userId: identity.userId,
      parentMessageId: input.attach.messageId,
    });
  }

  const started = await startExploreTurn(client, {
    conversationId: input.conversationId,
    newId,
    userId: identity.userId,
    question: input.question,
    attach: input.attach,
  });
  return { ...started, question: input.question };
}

function createDeferred(): {
  promise: Promise<null>;
  resolve: (value: null) => void;
} {
  const deferred = Promise.withResolvers<null>();
  return { promise: deferred.promise, resolve: deferred.resolve };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const exploreRunManager = new ExploreRunManager();
