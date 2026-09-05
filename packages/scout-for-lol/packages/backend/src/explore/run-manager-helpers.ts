import * as Sentry from "@sentry/bun";
import {
  ExploreRunPreviewEventSchema,
  ExploreRunSnapshotEventSchema,
} from "@scout-for-lol/data";
import type {
  ExploreActiveRun,
  ExploreMessage,
  ExploreRunOutcome,
  ExploreStreamEvent,
  ExploreTurnRequest,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type {
  ExploreRateLimitIdentity,
  ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import {
  ExploreInvalidTurnError,
  resolveRegenerateTarget,
  startExploreTurn,
} from "#src/explore/store.ts";
import { runPersistedExploreTurn } from "#src/explore/run-turn.ts";
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

/**
 * One place that decides what a fresh in-memory run starts out holding.
 *
 * Both the ordinary start path and Temporal rehydration build an `ActiveRun`,
 * and they had drifted into two copies of the same literal — so every field
 * added to the live-run state had to be remembered twice, and forgetting one
 * would leave rehydrated runs silently missing it.
 */
export function createActiveExploreRun(input: {
  summary: ExploreActiveRun;
  identity: ExploreRateLimitIdentity;
  guildIds: string[];
  ticket: ExploreRateLimitTicket;
  started: StartedTurn;
  history: ExploreMessage[];
}): ActiveRun {
  const deferred = createDeferred();
  return {
    summary: input.summary,
    identity: input.identity,
    guildIds: input.guildIds,
    ticket: input.ticket,
    started: input.started,
    history: input.history,
    abortController: new AbortController(),
    subscribers: new Set(),
    answer: "",
    activity: "Thinking…",
    trace: [],
    preview: null,
    termination: null,
    settled: deferred.promise,
    resolveSettled: deferred.resolve,
  };
}

/**
 * Everything an attaching observer is sent, in order.
 *
 * The result travels as its own `run_preview` event rather than as a field on
 * the snapshot, and that is a compatibility requirement rather than a
 * preference: every bundle already open in a browser parses the snapshot
 * strictly, so an added key makes the snapshot itself unparseable there. The
 * reader calls that a corrupted stream, reconnects, and receives the same
 * rejected snapshot for the rest of the turn.
 */
export function attachEvents(run: ActiveRun): ExploreStreamEvent[] {
  const snapshot = ExploreRunSnapshotEventSchema.parse({
    type: "snapshot",
    ...run.summary,
    answer: run.answer.length === 0 ? null : run.answer,
    activity: run.activity,
    trace: run.trace,
  });
  if (run.preview === null) {
    return [snapshot];
  }
  return [
    snapshot,
    ExploreRunPreviewEventSchema.parse({
      type: "run_preview",
      preview: run.preview,
    }),
  ];
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
          if (event.type === "final") {
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
