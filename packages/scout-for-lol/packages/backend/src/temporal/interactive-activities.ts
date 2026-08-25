import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import {
  DiscordGuildIdSchema,
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_TIMEOUT_MS,
  ExploreRunOutcomeSchema,
  ExploreTraceEntrySchema,
  ReportAiEditRequestSchema,
  ReportAiStreamEventSchema,
  type ExploreRunOutcome,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import type {
  InteractiveOutcome,
  ScoutInteractiveRunInput,
} from "@scout-for-lol/temporal";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { exploreRunManager } from "#src/explore/run-manager.ts";
import { persistPartialAnswer } from "#src/explore/partial-answer.ts";
import { loadExploreTranscript } from "#src/explore/store.ts";
import { runPersistedExploreTurn } from "#src/explore/run-turn.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import type { ExploreRateLimitTicket } from "#src/explore/rate-limit.ts";
import { recordExploreTraceEvent } from "#src/explore/trace.ts";
import { streamReportQueryAgent } from "#src/reports/ai/report-query-agent.ts";
import { getReportAiQuotaStatus } from "#src/reports/ai/rate-limit.ts";
import { scoutTemporalInterruptedProviderAttempts } from "#src/metrics/temporal.ts";
import type { ScoutInteractiveRun } from "#generated/prisma/client/index.js";

const ExplorePayloadSchema = z.strictObject({
  summary: z.looseObject({ runId: z.uuid() }),
  started: z.strictObject({
    conversationId: z.uuid(),
    title: z.string(),
    messageId: z.uuid(),
    question: z.string(),
    expectedCurrentLeafId: z.uuid().nullable(),
    previousCurrentLeafId: z.uuid().nullable(),
    createdConversation: z.boolean(),
    createdQuestion: z.boolean(),
  }),
  guildIds: z.array(z.string()),
});

const ReportAiPayloadSchema = z.strictObject({
  edit: ReportAiEditRequestSchema,
  exempt: z.boolean(),
});

function mapExploreOutcome(
  outcome: z.infer<typeof ExploreRunOutcomeSchema>,
  partialOutputAvailable: boolean,
): InteractiveOutcome {
  if (outcome === "succeeded") {
    return { status: "completed", partialOutputAvailable };
  }
  if (outcome === "stopped") {
    return { status: "cancelled", partialOutputAvailable };
  }
  if (outcome === "interrupted") {
    return { status: "interrupted", partialOutputAvailable };
  }
  return { status: "failed", partialOutputAvailable };
}

async function salvageAmbiguousExploreRun(input: {
  database: ExtendedPrismaClient;
  run: ScoutInteractiveRun;
}): Promise<InteractiveOutcome> {
  const parsedPayload = ExplorePayloadSchema.parse(
    JSON.parse(input.run.payload),
  );
  const trace = z
    .array(ExploreTraceEntrySchema)
    .parse(input.run.trace === null ? [] : JSON.parse(input.run.trace));
  const salvaged = await persistPartialAnswer(input.database, {
    stopped: false,
    conversationId: parsedPayload.started.conversationId,
    parentMessageId: parsedPayload.started.messageId,
    expectedCurrentLeafId: parsedPayload.started.expectedCurrentLeafId,
    text: input.run.partialOutput ?? "",
    trace,
    existingMessageId: input.run.resultMessageId,
  });
  await input.database.scoutInteractiveRun.update({
    where: { id: input.run.id },
    data: {
      state: "INTERRUPTED",
      outcome: "interrupted",
      completedAt: new Date(),
      lastError:
        "Provider attempt state was ambiguous after restart; Scout did not issue a second model request.",
    },
  });
  scoutTemporalInterruptedProviderAttempts.inc({ kind: "explore" });
  return {
    status: "interrupted",
    partialOutputAvailable: salvaged !== null,
  };
}

type MonitoredPromise<T> =
  { status: "completed"; value: T } | { status: "failed"; error: unknown };

async function monitorPromise<T>(
  promise: Promise<T>,
): Promise<MonitoredPromise<T>> {
  try {
    return { status: "completed", value: await promise };
  } catch (error) {
    return { status: "failed", error };
  }
}

async function heartbeatTick(milliseconds: number): Promise<null> {
  await Bun.sleep(milliseconds);
  return null;
}

function throwExecutionError(error: unknown): never {
  if (error instanceof Error) throw error;
  throw new Error("Interactive execution failed with a non-Error value", {
    cause: error,
  });
}

async function runUntilSettled<T>(input: {
  execution: Promise<T>;
  intervalMs: number;
  heartbeat: () => Promise<void>;
}): Promise<T> {
  const monitored = monitorPromise(input.execution);
  for (;;) {
    const result = await Promise.race([
      monitored,
      heartbeatTick(input.intervalMs),
    ]);
    if (result === null) {
      await input.heartbeat();
    } else if (result.status === "completed") {
      return result.value;
    } else {
      throwExecutionError(result.error);
    }
  }
}

export async function executeRecoveredReportAi(
  run: ScoutInteractiveRun,
  abortSignal: AbortSignal,
  database: ExtendedPrismaClient,
): Promise<InteractiveOutcome> {
  const payload = ReportAiPayloadSchema.parse(JSON.parse(run.payload));
  const guildId = DiscordGuildIdSchema.parse(run.guildId);
  const events: ReportAiStreamEvent[] = [];
  let partial = "";
  const emit = async (rawEvent: ReportAiStreamEvent): Promise<void> => {
    const event = ReportAiStreamEventSchema.parse(rawEvent);
    events.push(event);
    if (event.type === "draft_delta") partial += event.text;
    await database.scoutInteractiveRun.update({
      where: { id: run.id },
      data: {
        partialOutput: partial.length === 0 ? null : partial,
        trace: JSON.stringify(events),
      },
    });
  };
  const draft = await streamReportQueryAgent({
    runId: run.id,
    input: payload.edit,
    abortSignal,
    emit,
  });
  await emit({
    type: "final",
    draft,
    formattedQueryText: draft.queryText,
    quota: getReportAiQuotaStatus(
      { userId: run.ownerId, guildId },
      Date.now(),
      { exempt: payload.exempt },
    ).quota,
  });
  return {
    status: "completed",
    partialOutputAvailable: partial.length > 0,
  };
}

async function runReportAiActivity(
  run: ScoutInteractiveRun,
  database: ExtendedPrismaClient,
): Promise<InteractiveOutcome> {
  const { reportAiRuntime } =
    await import("#src/reports/ai/temporal-runtime.ts");
  const runtime = reportAiRuntime(run.id);
  const abortController = runtime?.abortController ?? new AbortController();
  const cancellationSignal = Context.current().cancellationSignal;
  const cancel = (): void => {
    abortController.abort("Report AI edit cancelled by its Temporal Workflow.");
  };
  cancellationSignal.addEventListener("abort", cancel, { once: true });
  if (cancellationSignal.aborted) cancel();
  try {
    return await runUntilSettled({
      execution:
        runtime === undefined
          ? executeRecoveredReportAi(run, abortController.signal, database)
          : runtime.execute(),
      intervalMs: 5000,
      heartbeat: async () => {
        const snapshot = await database.scoutInteractiveRun.findUniqueOrThrow({
          where: { id: run.id },
          select: { partialOutput: true, stopRequestedAt: true },
        });
        if (snapshot.stopRequestedAt !== null) cancel();
        Context.current().heartbeat({
          runId: run.id,
          partialCharacters: snapshot.partialOutput?.length ?? 0,
        });
      },
    });
  } finally {
    cancellationSignal.removeEventListener("abort", cancel);
  }
}

export async function executeRecoveredExplore(
  run: ScoutInteractiveRun,
  abortSignal: AbortSignal,
  database: ExtendedPrismaClient,
): Promise<ExploreRunOutcome> {
  const payload = ExplorePayloadSchema.parse(JSON.parse(run.payload));
  const transcript = await loadExploreTranscript(
    database,
    payload.started.conversationId,
    run.ownerId,
    payload.started.messageId,
  );
  if (transcript === null) {
    throw ApplicationFailure.nonRetryable(
      `Explore conversation ${payload.started.conversationId} no longer exists`,
      "MissingDomainRecord",
    );
  }
  const trace: ExploreTraceEntry[] = [];
  let partial = "";
  const ticket: ExploreRateLimitTicket = {
    allowed: true,
    runId: run.id,
    claimConversation: () => true,
    commit: () => {
      // The database reservation is already the authoritative quota claim.
    },
    finish: () => {
      // Durable cleanup releases quota when this Activity records its outcome.
    },
  };
  const emit = async (event: ExploreStreamEvent): Promise<void> => {
    if (event.type === "answer_delta") {
      const available = EXPLORE_ANSWER_MAX_LENGTH - partial.length;
      if (available > 0) partial += event.text.slice(0, available);
    } else if (event.type === "final") {
      partial = event.message.content;
    }
    recordExploreTraceEvent(trace, event);
    await database.scoutInteractiveRun.update({
      where: { id: run.id },
      data: {
        partialOutput: partial.length === 0 ? null : partial,
        trace: JSON.stringify(trace),
        ...(event.type === "final"
          ? { resultMessageId: event.message.id }
          : {}),
      },
    });
  };
  const result = await runPersistedExploreTurn(
    {
      ticket,
      identity: { userId: run.ownerId },
      guildIds: payload.guildIds,
      started: payload.started,
      history: transcript.messages,
      abortSignal,
      abortOutcome: () => "stopped",
      emit,
    },
    {
      client: database,
      executeAgent: streamExploreAgent,
      now: Date.now,
      timeoutMs: EXPLORE_TIMEOUT_MS,
    },
  );
  return result.outcome;
}

async function runExploreActivity(
  run: ScoutInteractiveRun,
  database: ExtendedPrismaClient,
): Promise<InteractiveOutcome> {
  const cancellationSignal = Context.current().cancellationSignal;
  const recoveredAbortController = new AbortController();
  const localRuntime = exploreRunManager.snapshot(run.id) !== undefined;
  const cancel = (): void => {
    if (localRuntime) {
      exploreRunManager.cancelTemporal(
        run.id,
        "Explore turn cancelled by its Temporal Workflow.",
      );
    } else {
      recoveredAbortController.abort(
        "Explore turn cancelled by its Temporal Workflow.",
      );
    }
  };
  cancellationSignal.addEventListener("abort", cancel, { once: true });
  if (cancellationSignal.aborted) cancel();
  try {
    const outcome = await runUntilSettled({
      execution: localRuntime
        ? exploreRunManager.executeTemporal(run.id)
        : executeRecoveredExplore(
            run,
            recoveredAbortController.signal,
            database,
          ),
      intervalMs: 1000,
      heartbeat: async () => {
        const snapshot = exploreRunManager.snapshot(run.id);
        const control = await database.scoutInteractiveRun.findUniqueOrThrow({
          where: { id: run.id },
          select: { partialOutput: true, stopRequestedAt: true },
        });
        if (control.stopRequestedAt !== null) cancel();
        if (snapshot !== undefined) {
          await database.scoutInteractiveRun.update({
            where: { id: run.id },
            data: {
              partialOutput: snapshot.answer,
              trace: JSON.stringify(snapshot.trace),
            },
          });
        }
        Context.current().heartbeat({
          runId: run.id,
          partialCharacters:
            snapshot?.answer.length ?? control.partialOutput?.length ?? 0,
          traceEntries: snapshot?.trace.length ?? 0,
        });
      },
    });
    const persisted = await database.scoutInteractiveRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { partialOutput: true },
    });
    return mapExploreOutcome(
      ExploreRunOutcomeSchema.parse(outcome),
      (persisted.partialOutput?.length ?? 0) > 0,
    );
  } finally {
    cancellationSignal.removeEventListener("abort", cancel);
  }
}

async function ambiguousOutcome(
  run: ScoutInteractiveRun,
  database: ExtendedPrismaClient,
): Promise<InteractiveOutcome> {
  if (run.kind === "report-ai") {
    scoutTemporalInterruptedProviderAttempts.inc({ kind: "report-ai" });
    return {
      status: "interrupted",
      partialOutputAvailable: (run.partialOutput?.length ?? 0) > 0,
    };
  }
  return await salvageAmbiguousExploreRun({ database, run });
}

export async function runScoutInteractiveActivity(
  input: ScoutInteractiveRunInput,
  database: ExtendedPrismaClient = prisma,
): Promise<InteractiveOutcome> {
  const run = await database.scoutInteractiveRun.findUniqueOrThrow({
    where: { id: input.databaseRunId },
  });
  if (run.kind !== input.kind) {
    throw ApplicationFailure.nonRetryable(
      `Interactive run ${run.id} has kind ${run.kind}, expected ${input.kind}`,
      "InvalidInteractiveRunKind",
    );
  }
  if (run.stopRequestedAt !== null) {
    return { status: "cancelled", partialOutputAvailable: false };
  }
  if (run.providerAttemptAt !== null) {
    return await ambiguousOutcome(run, database);
  }

  const claim = await database.scoutInteractiveRun.updateMany({
    where: { id: run.id, providerAttemptAt: null, state: "PENDING" },
    data: {
      state: "RUNNING",
      startedAt: new Date(),
      providerAttemptAt: new Date(),
    },
  });
  if (claim.count !== 1) {
    throw new Error(
      `Interactive run ${run.id} could not claim provider attempt`,
    );
  }

  if (input.kind === "report-ai") {
    return await runReportAiActivity(run, database);
  }
  return await runExploreActivity(run, database);
}

export async function persistScoutInteractiveOutcome(
  input: ScoutInteractiveRunInput & { outcome: InteractiveOutcome },
  database: ExtendedPrismaClient = prisma,
): Promise<InteractiveOutcome> {
  const run = await database.scoutInteractiveRun.update({
    where: { id: input.databaseRunId },
    data: {
      state:
        input.outcome.status === "completed"
          ? "COMPLETED"
          : input.outcome.status === "cancelled"
            ? "CANCELLED"
            : input.outcome.status === "interrupted"
              ? "INTERRUPTED"
              : "FAILED",
      outcome: input.outcome.status,
      completedAt: new Date(),
    },
    select: { partialOutput: true },
  });
  const outcome = {
    ...input.outcome,
    partialOutputAvailable: (run.partialOutput?.length ?? 0) > 0,
  };
  if (input.kind === "report-ai") {
    const { reportAiRuntime } =
      await import("#src/reports/ai/temporal-runtime.ts");
    reportAiRuntime(input.databaseRunId)?.finish(outcome);
  }
  return outcome;
}
