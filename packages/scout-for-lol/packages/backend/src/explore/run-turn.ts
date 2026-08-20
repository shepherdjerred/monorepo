import * as Sentry from "@sentry/bun";
import {
  EXPLORE_TIMEOUT_MS,
  type ExploreMessage,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import {
  getExploreQuotaStatus,
  type ExploreRateLimitIdentity,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import {
  appendExploreAnswer,
  applyGeneratedTitle,
} from "#src/explore/store.ts";
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
 * message after this runner completes. The web app has a separate process-wide
 * manager because navigation must detach observers without cancelling work;
 * both paths share the same agent, trace, partial-answer, and storage helpers.
 */
export async function runPersistedExploreTurn(
  input: {
    ticket: ExploreRateLimitTicket;
    identity: ExploreRateLimitIdentity;
    started: StartedExploreTurn;
    history: ExploreMessage[];
    abortSignal?: AbortSignal;
    emit: (event: ExploreStreamEvent) => void | Promise<void>;
  },
  dependencies: ExploreTurnDependencies = defaultDependencies,
): Promise<ExploreTurnTerminalEvent> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort("Explore turn timed out.");
  }, dependencies.timeoutMs);
  const abortFromCaller = () => {
    abortController.abort(input.abortSignal?.reason);
  };
  input.abortSignal?.addEventListener("abort", abortFromCaller);
  if (input.abortSignal?.aborted === true) {
    abortFromCaller();
  }

  let runStatus = "error";
  const startedAt = dependencies.now();
  scoutExploreActiveRuns.inc();
  input.ticket.commit();

  const trace: ExploreTraceEntry[] = [];
  let streamedAnswer = "";
  const record = async (event: ExploreStreamEvent): Promise<void> => {
    if (event.type === "answer_delta") {
      streamedAnswer += event.text;
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
    const result = await dependencies.executeAgent({
      runId: input.ticket.runId,
      question: input.started.question,
      // The last history item is the question being answered. The agent gets
      // that separately as its current turn, so replaying it duplicates it.
      history: input.history.slice(0, -1),
      abortSignal: abortController.signal,
      emit: record,
    });
    const message = await appendExploreAnswer(dependencies.client, {
      conversationId: input.started.conversationId,
      parentMessageId: input.started.messageId,
      answer: result.answer,
      preview: result.preview,
      visualization: result.visualization,
      trace: finalizeExploreTrace(trace),
      expectedCurrentLeafId: input.started.expectedCurrentLeafId,
    });
    const title =
      result.answer.title === null
        ? input.started.title
        : await applyGeneratedTitle(dependencies.client, {
            conversationId: input.started.conversationId,
            title: result.answer.title,
          });
    input.ticket.finish();
    runStatus = "success";
    const terminal: ExploreTurnTerminalEvent = {
      type: "final",
      message,
      title,
      quota: getExploreQuotaStatus(input.identity, dependencies.now()).quota,
    };
    await input.emit(terminal);
    return terminal;
  } catch (error) {
    runStatus = abortController.signal.aborted ? "cancelled" : "error";
    if (!abortController.signal.aborted) {
      logger.error("Explore turn failed mid-stream", errorMessage(error));
      Sentry.captureException(error, {
        tags: { source: "explore-turn-run" },
      });
    }

    let salvaged: ExploreMessage | null = null;
    try {
      salvaged = await persistPartialAnswer(dependencies.client, {
        stopped: input.abortSignal?.aborted === true,
        conversationId: input.started.conversationId,
        parentMessageId: input.started.messageId,
        expectedCurrentLeafId: input.started.expectedCurrentLeafId,
        text: streamedAnswer,
        trace,
        existingMessageId: null,
      });
    } catch (salvageError) {
      logger.error(
        "Failed to salvage a stopped explore turn",
        errorMessage(salvageError),
      );
      Sentry.captureException(salvageError, {
        tags: { source: "explore-salvage" },
      });
    }

    input.ticket.finish();
    const quota = getExploreQuotaStatus(
      input.identity,
      dependencies.now(),
    ).quota;
    const terminal: ExploreTurnTerminalEvent =
      salvaged === null
        ? {
            type: "error",
            message: clampExploreMessage(errorMessage(error)),
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
    return terminal;
  } finally {
    clearTimeout(timeout);
    input.abortSignal?.removeEventListener("abort", abortFromCaller);
    input.ticket.finish();
    scoutExploreActiveRuns.dec();
    scoutExploreTurnsTotal.inc({ status: runStatus });
    scoutExploreTurnDurationSeconds
      .labels(runStatus)
      .observe((dependencies.now() - startedAt) / 1000);
  }
}

const MESSAGE_MAX_LENGTH = 1000;

/** Fit a message inside the HTTP and stream error schemas. */
export function clampExploreMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return "Request failed.";
  }
  if (trimmed.length <= MESSAGE_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
