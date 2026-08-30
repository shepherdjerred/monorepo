import * as Sentry from "@sentry/bun";
import {
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_TIMEOUT_MS,
  type ExploreMessage,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import {
  ExploreConversationBusyError,
  getExploreQuotaStatus,
  type ExploreRateLimitIdentity,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import { appendExploreAnswer } from "#src/explore/store.ts";
import {
  applyGeneratedTitle,
  rollbackGeneratedTitle,
  type GeneratedTitleRollback,
} from "#src/explore/generated-title.ts";
import { persistPartialAnswer } from "#src/explore/partial-answer.ts";
import {
  finalizeExploreTrace,
  recordExploreTraceEvent,
} from "#src/explore/trace.ts";
import { createLogger } from "#src/logger.ts";
import {
  scoutExploreActiveRuns,
  scoutExploreTurnDurationSeconds,
  scoutExploreTurnsTotal,
} from "#src/metrics/explore.ts";

const logger = createLogger("explore-turn");

export type StartedExploreTurn = {
  conversationId: string;
  title: string;
  messageId: string;
  question: string;
  expectedCurrentLeafId: string | null;
};

export type ExploreTurnTerminalEvent = Extract<
  ExploreStreamEvent,
  { type: "error" | "final" }
>;
export type ExploreTurnOutcome = Extract<
  ExploreStreamEvent,
  { type: "done" }
>["outcome"];
export type ExplorePersistedTurnResult = ExploreTurnTerminalEvent & {
  outcome: ExploreTurnOutcome;
};

type ExploreTurnDependencies = {
  client: ExtendedPrismaClient;
  executeAgent: typeof streamExploreAgent;
  now: () => number;
  timeoutMs: number;
};

const defaultDependencies: ExploreTurnDependencies = {
  client: prisma,
  executeAgent: streamExploreAgent,
  now: Date.now,
  timeoutMs: EXPLORE_TIMEOUT_MS,
};

/**
 * Run and persist one Explore turn independently of its delivery adapter.
 *
 * Discord ignores the progressive events and renders the returned frozen
 * message after this runner completes. The web manager retains observer state
 * around this runner; execution, quota, timeout, metrics, salvage, and storage
 * remain here so the delivery adapters cannot drift.
 */
export async function runPersistedExploreTurn(
  input: {
    ticket: ExploreRateLimitTicket;
    identity: ExploreRateLimitIdentity;
    started: StartedExploreTurn;
    history: ExploreMessage[];
    /** The asker's servers; scopes `player('…')` alias resolution. */
    guildIds: string[];
    abortSignal?: AbortSignal;
    abortOutcome?: () => Extract<ExploreTurnOutcome, "stopped" | "interrupted">;
    emit: (event: ExploreStreamEvent) => void | Promise<void>;
  },
  dependencies: ExploreTurnDependencies = defaultDependencies,
): Promise<ExplorePersistedTurnResult> {
  if (!input.ticket.claimConversation(input.started.conversationId)) {
    input.ticket.finish();
    throw new ExploreConversationBusyError(
      "This conversation already has an answer running.",
    );
  }
  const abortController = new AbortController();
  let cancellationOutcome: Extract<
    ExploreTurnOutcome,
    "stopped" | "interrupted"
  > | null = null;
  const abort = (
    outcome: Exclude<typeof cancellationOutcome, null>,
    reason: unknown,
  ): void => {
    if (abortController.signal.aborted) return;
    cancellationOutcome = outcome;
    abortController.abort(reason);
  };
  const timeout = setTimeout(() => {
    abort("interrupted", "Explore turn timed out.");
  }, dependencies.timeoutMs);
  const abortFromCaller = () => {
    abort(input.abortOutcome?.() ?? "stopped", input.abortSignal?.reason);
  };
  input.abortSignal?.addEventListener("abort", abortFromCaller);
  if (input.abortSignal?.aborted === true) {
    abortFromCaller();
  }

  let runStatus = "error";
  const startedAt = dependencies.now();
  scoutExploreActiveRuns.inc();
  input.ticket.commit();
  let ticketFinished = false;
  const finishTicket = (): void => {
    if (ticketFinished) return;
    ticketFinished = true;
    input.ticket.finish();
  };

  const trace: ExploreTraceEntry[] = [];
  let streamedAnswer = "";
  let persistedMessage: ExploreMessage | null = null;
  let generatedTitleRollback: GeneratedTitleRollback | null = null;
  const record = async (event: ExploreStreamEvent): Promise<void> => {
    if (event.type === "answer_delta") {
      const available = EXPLORE_ANSWER_MAX_LENGTH - streamedAnswer.length;
      if (available > 0) {
        streamedAnswer += event.text.slice(0, available);
      }
    }
    recordExploreTraceEvent(trace, event);
    await input.emit(event);
  };

  try {
    await input.emit({
      type: "started",
      runId: input.ticket.runId,
      conversationId: input.started.conversationId,
      questionMessageId: input.started.messageId,
    });
    throwIfAborted(abortController.signal);
    const result = await dependencies.executeAgent({
      runId: input.ticket.runId,
      subject: { kind: "discord_user", id: input.identity.userId },
      question: input.started.question,
      // The last history item is the question being answered. The agent gets
      // that separately as its current turn, so replaying it duplicates it.
      history: input.history.slice(0, -1),
      guildIds: input.guildIds,
      abortSignal: abortController.signal,
      emit: record,
    });
    throwIfAborted(abortController.signal);
    persistedMessage = await appendExploreAnswer(dependencies.client, {
      conversationId: input.started.conversationId,
      parentMessageId: input.started.messageId,
      answer: result.answer,
      preview: result.preview,
      visualization: result.visualization,
      trace: finalizeExploreTrace(trace),
      expectedCurrentLeafId: input.started.expectedCurrentLeafId,
    });
    throwIfAborted(abortController.signal);
    let title = input.started.title;
    if (result.answer.title !== null) {
      const titleUpdate = await applyGeneratedTitle(dependencies.client, {
        conversationId: input.started.conversationId,
        title: result.answer.title,
      });
      title = titleUpdate.title;
      generatedTitleRollback = titleUpdate.rollback;
    }
    throwIfAborted(abortController.signal);
    finishTicket();
    runStatus = "success";
    const terminal: ExploreTurnTerminalEvent = {
      type: "final",
      message: persistedMessage,
      title,
      quota: getExploreQuotaStatus(input.identity, dependencies.now()).quota,
    };
    await input.emit(terminal);
    return { ...terminal, outcome: "succeeded" };
  } catch (error) {
    const outcome = abortController.signal.aborted
      ? resolveCancellationOutcome(cancellationOutcome)
      : "failed";
    runStatus = outcome === "failed" ? "error" : "cancelled";
    if (outcome === "failed") {
      logger.error("Explore turn failed mid-stream", errorMessage(error));
      Sentry.captureException(error, {
        tags: { source: "explore-turn-run" },
      });
    }

    let salvaged: ExploreMessage | null = null;
    try {
      salvaged = await persistPartialAnswer(dependencies.client, {
        stopped: outcome === "stopped",
        conversationId: input.started.conversationId,
        parentMessageId: input.started.messageId,
        expectedCurrentLeafId: input.started.expectedCurrentLeafId,
        text: streamedAnswer,
        trace,
        existingMessageId: persistedMessage?.id ?? null,
      });
      if (salvaged === null && generatedTitleRollback !== null) {
        await rollbackGeneratedTitle(dependencies.client, {
          conversationId: input.started.conversationId,
          ...generatedTitleRollback,
        });
      }
    } catch (salvageError) {
      logger.error(
        "Failed to salvage a stopped explore turn",
        errorMessage(salvageError),
      );
      Sentry.captureException(salvageError, {
        tags: { source: "explore-salvage" },
      });
    }

    finishTicket();
    const quota = getExploreQuotaStatus(
      input.identity,
      dependencies.now(),
    ).quota;
    const terminal: ExploreTurnTerminalEvent =
      salvaged === null
        ? {
            type: "error",
            message:
              outcome === "stopped"
                ? "This question was stopped before an answer was produced."
                : "This answer could not be completed.",
            retryAfterSeconds: null,
            quota,
          }
        : {
            type: "final",
            message: salvaged,
            title: input.started.title,
            quota,
          };
    await input.emit(terminal);
    return { ...terminal, outcome };
  } finally {
    clearTimeout(timeout);
    input.abortSignal?.removeEventListener("abort", abortFromCaller);
    finishTicket();
    scoutExploreActiveRuns.dec();
    scoutExploreTurnsTotal.inc({ status: runStatus });
    scoutExploreTurnDurationSeconds
      .labels(runStatus)
      .observe((dependencies.now() - startedAt) / 1000);
  }
}

function resolveCancellationOutcome(
  outcome: Extract<ExploreTurnOutcome, "stopped" | "interrupted"> | null,
): Extract<ExploreTurnOutcome, "stopped" | "interrupted"> {
  return outcome ?? "interrupted";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("Explore turn aborted.");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
