import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import * as Sentry from "@sentry/bun";
import {
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_TIMEOUT_MS,
  type DiscordChannelId,
  type ExploreMessage,
  ExploreStreamMessageSchema,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import { ExploreBudgetError } from "#src/explore/spending/ledger.ts";
import { ExploreCardSelectionError } from "#src/explore-match/card-selection-error.ts";
import { durableExploreQuotaStatus } from "#src/temporal/durable-quota.ts";
import {
  ExploreConversationBusyError,
  getExploreQuotaStatus,
  type ExploreRateLimitIdentity,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import { appendExploreAnswer } from "#src/explore/store.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";
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
import { graphemePrefix } from "@shepherdjerred/text";

const logger = createLogger("explore-turn");

export type StartedExploreTurn = {
  model?: string | undefined;
  conversationId: string;
  title: string;
  messageId: ExploreMessage["id"];
  question: string;
  expectedCurrentLeafId: string | null;
};

export type ExploreTurnTerminalEvent =
  | Extract<ExploreStreamEvent, { type: "error" }>
  | (Omit<Extract<ExploreStreamEvent, { type: "final" }>, "message"> & {
      /** The runner returns the full persisted record for non-web surfaces. */
      message: ExploreMessage;
    });
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

async function turnQuota(
  input: ExploreRateLimitIdentity,
  dependencies: ExploreTurnDependencies,
  durable: boolean,
) {
  if (!durable) return getExploreQuotaStatus(input, dependencies.now()).quota;
  const status = await durableExploreQuotaStatus(
    input.userId,
    dependencies.now(),
    dependencies.client,
  );
  return status.quota;
}

function chosenModel(model: string | undefined) {
  return model === undefined ? {} : { model };
}
function storedProvenance(model: string | undefined) {
  return model === undefined
    ? {}
    : { generation: { model, reasoningEffort: "high" as const } };
}
/** Durable diagnostics contain categories, never provider/SQL/user payloads. */
export function exploreFailureCode(
  outcome: ExploreTurnOutcome,
  error: unknown,
): string {
  if (outcome === "stopped") return "explore:stopped";
  if (outcome === "interrupted") return "explore:interrupted";
  if (error instanceof ExploreBudgetError) return "explore:budget_exceeded";
  return error instanceof ExploreCardSelectionError
    ? `explore:invalid_${error.cardType}_card`
    : "explore:execution_failed";
}

function visibleError(outcome: ExploreTurnOutcome, error: unknown): string {
  if (outcome === "stopped")
    return "This question was stopped before an answer was produced.";
  return error instanceof ExploreBudgetError
    ? error.message
    : "This answer could not be completed.";
}

/**
 * A deployed server can finish a turn in a tab whose bundle predates a new
 * persisted message field. The terminal stream remains backward compatible;
 * the client refetches the complete transcript after `done`.
 */
function toStreamMessage(message: ExploreMessage) {
  // Every field added to the persisted message has to be dropped here, not
  // just the first one: the schema below is strict, so one unknown key makes
  // the terminal event unparseable in a tab that is already open and the
  // answer never lands there.
  const {
    generation: _generation,
    inlineEntities: _inlineEntities,
    matchCards: _matchCards,
    loadoutCards: _loadoutCards,
    guildIds: _guildIds,
    ...streamMessage
  } = message;
  return ExploreStreamMessageSchema.parse(streamMessage);
}

function toStreamTerminal(
  terminal: ExploreTurnTerminalEvent,
): ExploreStreamEvent {
  return terminal.type === "error"
    ? terminal
    : { ...terminal, message: toStreamMessage(terminal.message) };
}

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
    guildIds: DiscordGuildId[];
    /**
     * Which surface is asking. Required rather than defaulted: it decides how
     * the answer is delivered and how the asker's permissions are learned, and
     * a silent default would get both wrong for a forgotten call site.
     */
    surface: ExploreSurface;
    abortSignal?: AbortSignal;
    originChannelId?: DiscordChannelId | undefined;
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
  // Once a delta is cut at the cap, later deltas must not append: the cut may
  // have dropped a whole grapheme, and appending past it would skip text.
  let streamedAnswerCapped = false;
  let persistedMessage: ExploreMessage | null = null;
  let generatedTitleRollback: GeneratedTitleRollback | null = null;
  const record = async (event: ExploreStreamEvent): Promise<void> => {
    if (event.type === "answer_delta") {
      const available = EXPLORE_ANSWER_MAX_LENGTH - streamedAnswer.length;
      if (!streamedAnswerCapped && available > 0) {
        const text = graphemePrefix(event.text, available);
        streamedAnswer += text;
        streamedAnswerCapped = text.length < event.text.length;
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
      ...chosenModel(input.started.model),
      runId: input.ticket.runId,
      conversationId: input.started.conversationId,
      subject: { kind: "discord_user", id: input.identity.userId },
      question: input.started.question,
      // The last history item is the question being answered. The agent gets
      // that separately as its current turn, so replaying it duplicates it.
      history: input.history.slice(0, -1),
      guildIds: input.guildIds,
      requesterId: input.identity.userId,
      originChannelId: input.originChannelId ?? null,
      surface: input.surface,
      abortSignal: abortController.signal,
      emit: record,
    });
    throwIfAborted(abortController.signal);
    persistedMessage = await appendExploreAnswer(dependencies.client, {
      // The same guilds the agent resolved its capabilities from, recorded on
      // the turn so a later replay needs no archaeology to reproduce it.
      guildIds: input.guildIds,
      conversationId: input.started.conversationId,
      parentMessageId: input.started.messageId,
      answer: result.answer,
      ...(result.inlineEntities === undefined
        ? {}
        : { inlineEntities: result.inlineEntities }),
      ...storedProvenance(input.started.model),
      preview: result.preview,
      visualization: result.visualization,
      matchCards: result.matchCards,
      loadoutCards: result.loadoutCards,
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
      quota: await turnQuota(
        input.identity,
        dependencies,
        input.ticket.durable === true,
      ),
    };
    await input.emit(toStreamTerminal(terminal));
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

    // A failure after the complete answer was saved — the title update, the
    // quota read, the final emit — still leaves a whole answer. Replacing it
    // with the streamed prefix and an "interrupted" caveat is how a finished
    // prod game review came to be labelled as cut off. Salvage is for answers
    // that never finished.
    const salvaged =
      outcome === "failed" && persistedMessage !== null
        ? persistedMessage
        : await salvagePartialAnswer({
            client: dependencies.client,
            started: input.started,
            guildIds: input.guildIds,
            stopped: outcome === "stopped",
            text: streamedAnswer,
            trace,
            existingMessageId: persistedMessage?.id ?? null,
            generatedTitleRollback,
          });

    finishTicket();
    const quota = await turnQuota(
      input.identity,
      dependencies,
      input.ticket.durable === true,
    );
    await dependencies.client.scoutInteractiveRun.updateMany({
      where: { id: input.ticket.runId },
      data: { lastError: exploreFailureCode(outcome, error) },
    });
    const terminal: ExploreTurnTerminalEvent =
      salvaged === null
        ? {
            type: "error",
            message: visibleError(outcome, error),
            retryAfterSeconds: null,
            quota,
          }
        : {
            type: "final",
            message: salvaged,
            title: input.started.title,
            quota,
          };
    await input.emit(toStreamTerminal(terminal));
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

/**
 * Save the useful prefix of an unfinished answer, rolling back a generated
 * title when nothing was worth keeping. A salvage failure is logged and
 * reported, never thrown: the turn has already failed, and the caller still
 * owes the client a terminal event.
 */
async function salvagePartialAnswer(input: {
  client: ExtendedPrismaClient;
  started: StartedExploreTurn;
  guildIds: readonly DiscordGuildId[];
  stopped: boolean;
  text: string;
  trace: ExploreTraceEntry[];
  existingMessageId: string | null;
  generatedTitleRollback: GeneratedTitleRollback | null;
}): Promise<ExploreMessage | null> {
  try {
    const salvaged = await persistPartialAnswer(input.client, {
      ...chosenModel(input.started.model),
      guildIds: input.guildIds,
      stopped: input.stopped,
      conversationId: input.started.conversationId,
      parentMessageId: input.started.messageId,
      expectedCurrentLeafId: input.started.expectedCurrentLeafId,
      text: input.text,
      trace: input.trace,
      existingMessageId: input.existingMessageId,
    });
    if (salvaged === null && input.generatedTitleRollback !== null) {
      await rollbackGeneratedTitle(input.client, {
        conversationId: input.started.conversationId,
        ...input.generatedTitleRollback,
      });
    }
    return salvaged;
  } catch (salvageError) {
    logger.error(
      "Failed to salvage a stopped explore turn",
      errorMessage(salvageError),
    );
    Sentry.captureException(salvageError, {
      tags: { source: "explore-salvage" },
    });
    return null;
  }
}

function resolveCancellationOutcome(
  outcome: Extract<ExploreTurnOutcome, "stopped" | "interrupted"> | null,
): Extract<ExploreTurnOutcome, "stopped" | "interrupted"> {
  let resolved = outcome;
  resolved ??= "interrupted";
  return resolved;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("Explore turn aborted.");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
