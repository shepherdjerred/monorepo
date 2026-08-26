import * as Sentry from "@sentry/bun";
import type {
  ExploreRunOutcome,
  ExploreStreamEvent,
  ExploreTurnRequest,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { ExploreRateLimitIdentity } from "#src/explore/rate-limit.ts";
import {
  ExploreInvalidTurnError,
  resolveRegenerateTarget,
  startExploreTurn,
} from "#src/explore/store.ts";
import { runPersistedExploreTurn } from "#src/explore/run-turn.ts";
import { temporalInteractiveEnabled } from "#src/config/dynamic.ts";
import { createLogger } from "#src/logger.ts";
import type {
  ActiveRun,
  ExploreAgentRunner,
  RunTermination,
  StartedTurn,
  TerminalRun,
} from "#src/explore/run-manager-types.ts";

export function abortActiveExploreRun(
  run: ActiveRun,
  reason: Exclude<RunTermination, null>,
  message: string,
): void {
  if (run.termination !== null) return;
  run.termination = reason;
  run.activity = reason === "stop" ? "Stopping…" : run.activity;
  run.abortController.abort(message);
}

export function recordTerminalExploreOutcome(
  terminalRuns: Map<string, TerminalRun>,
  run: ActiveRun,
  outcome: ExploreRunOutcome,
  ttlMs: number,
): void {
  const completedAt = Date.now();
  for (const [runId, terminal] of terminalRuns) {
    if (completedAt - terminal.completedAt > ttlMs) terminalRuns.delete(runId);
  }
  terminalRuns.set(run.summary.runId, {
    userId: run.identity.userId,
    outcome,
    completedAt,
  });
}

const logger = createLogger("explore-run-manager");

export async function resolveTurnTarget(
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

export function createDeferred(): {
  promise: Promise<null>;
  resolve: (value: null) => void;
} {
  const deferred = Promise.withResolvers<null>();
  return { promise: deferred.promise, resolve: deferred.resolve };
}

export async function executeActiveExploreRun(input: {
  run: ActiveRun;
  client: ExtendedPrismaClient;
  runAgent: ExploreAgentRunner;
  timeoutMs: number;
  record: (event: ExploreStreamEvent) => void;
}): Promise<ExploreRunOutcome> {
  try {
    const result = await runPersistedExploreTurn(
      {
        ticket: input.run.ticket,
        identity: input.run.identity,
        guildIds: input.run.guildIds,
        started: input.run.started,
        history: input.run.history,
        abortSignal: input.run.abortController.signal,
        abortOutcome: () =>
          input.run.termination === "stop" || input.run.termination === "delete"
            ? "stopped"
            : "interrupted",
        emit: async (event) => {
          input.record(event);
          if (event.type === "final" && temporalInteractiveEnabled()) {
            await input.client.scoutInteractiveRun.updateMany({
              where: { id: input.run.summary.runId },
              data: {
                partialOutput:
                  input.run.answer.length === 0 ? null : input.run.answer,
                trace: JSON.stringify(input.run.trace),
                resultMessageId: event.message.id,
              },
            });
          }
        },
      },
      {
        client: input.client,
        executeAgent: input.runAgent,
        now: Date.now,
        timeoutMs: input.timeoutMs,
      },
    );
    return result.outcome;
  } catch (error) {
    logger.error(
      "Shared Explore turn runner escaped unexpectedly",
      error instanceof Error ? error.message : String(error),
    );
    Sentry.captureException(error, {
      tags: { source: "explore-background-run-manager" },
    });
    return "failed";
  }
}
