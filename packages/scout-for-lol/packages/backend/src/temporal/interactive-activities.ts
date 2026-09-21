import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  ExploreActiveRunSchema,
  ExploreRunOutcomeSchema,
  ExploreTraceEntrySchema,
  ReportAiEditRequestSchema,
  ReportAiStreamEventSchema,
  type ExploreRunOutcome,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import type {
  InteractiveOutcome,
  ScoutInteractiveRunInput,
} from "@scout-for-lol/temporal";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  ExploreRunManager,
  exploreRunManager,
} from "#src/explore/runs/run-manager.ts";
import { persistPartialAnswer } from "#src/explore/partial-answer.ts";
import { ExploreNotFoundError } from "#src/explore/store.ts";
import { ExploreDurablePayloadSchema } from "#src/explore/runs/durable-payload.ts";
import { streamReportQueryAgent } from "#src/reports/ai/report-query-agent.ts";
import { getReportAiQuotaStatus } from "#src/reports/ai/rate-limit.ts";
import { scoutTemporalInterruptedProviderAttempts } from "#src/metrics/platform/temporal.ts";
import type { ScoutInteractiveRun } from "#generated/prisma/client/index.js";

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
  return outcome === "interrupted"
    ? { status: "interrupted", partialOutputAvailable }
    : { status: "failed", partialOutputAvailable };
}

async function salvageAmbiguousExploreRun(input: {
  database: ExtendedPrismaClient;
  run: ScoutInteractiveRun;
}): Promise<InteractiveOutcome> {
  const parsedPayload = ExploreDurablePayloadSchema.parse(
    JSON.parse(input.run.payload),
  );
  const trace = z
    .array(ExploreTraceEntrySchema)
    .parse(input.run.trace === null ? [] : JSON.parse(input.run.trace));
  const salvaged = await persistPartialAnswer(input.database, {
    stopped: false,
    // The payload is what this turn actually ran with, which is exactly the
    // guild context the salvaged answer should carry.
    guildIds: parsedPayload.guildIds,
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
      // Same reason as the outcome path below: these mirror a running turn's
      // progress and may name the person it looked up, so a terminal state
      // clears them rather than leaving them in an undeleted row.
      activity: null,
      preview: null,
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
    subject: {
      kind: "discord_user",
      id: DiscordAccountIdSchema.parse(run.ownerId),
    },
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
  suppliedManager?: ExploreRunManager,
): Promise<ExploreRunOutcome> {
  const payload = ExploreDurablePayloadSchema.parse(JSON.parse(run.payload));
  const manager =
    suppliedManager ??
    (database === prisma
      ? exploreRunManager
      : new ExploreRunManager({ client: database }));
  try {
    await manager.rehydrateTemporalRun({
      summary: ExploreActiveRunSchema.parse(payload.summary),
      identity: { userId: DiscordAccountIdSchema.parse(run.ownerId) },
      guildIds: payload.guildIds,
      started: payload.started,
      surface: payload.surface,
      originChannelId: payload.originChannelId,
    });
  } catch (error) {
    if (error instanceof ExploreNotFoundError) {
      throw ApplicationFailure.nonRetryable(
        `Explore conversation ${payload.started.conversationId} no longer exists`,
        "MissingDomainRecord",
      );
    }
    throw error;
  }
  const cancel = (): void => {
    manager.cancelTemporal(
      run.id,
      "Explore turn cancelled by its Temporal Workflow.",
    );
  };
  abortSignal.addEventListener("abort", cancel, { once: true });
  if (abortSignal.aborted) cancel();
  try {
    return await manager.executeTemporal(run.id);
  } finally {
    abortSignal.removeEventListener("abort", cancel);
  }
}

async function runExploreActivity(
  run: ScoutInteractiveRun,
  database: ExtendedPrismaClient,
): Promise<InteractiveOutcome> {
  const cancellationSignal = Context.current().cancellationSignal;
  const recoveredAbortController = new AbortController();
  const localRuntime = exploreRunManager.snapshot(run.id) !== undefined;
  /** Last preview written to the row, so an unchanged one is not rewritten. */
  let lastMirroredPreview: string | null = null;
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
          // `preview` is written only when it actually changed. It is small
          // by design but not trivial, and this runs once a second for the
          // life of the turn.
          const preview =
            snapshot.preview === null ? null : JSON.stringify(snapshot.preview);
          await database.scoutInteractiveRun.update({
            where: { id: run.id },
            data: {
              partialOutput: snapshot.answer,
              trace: JSON.stringify(snapshot.trace),
              activity: snapshot.activity,
              ...(preview === lastMirroredPreview ? {} : { preview }),
            },
          });
          lastMirroredPreview = preview;
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

  return input.kind === "report-ai"
    ? await runReportAiActivity(run, database)
    : await runExploreActivity(run, database);
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
      // Both are mirrored purely so a durable observer can follow a *running*
      // turn, and both may name the person the turn looked up — the activity
      // channel is the one place that text is allowed, precisely because it is
      // never stored. Rows here are not deleted, so leaving them behind would
      // turn "never persisted" into "persisted forever". A finished run has
      // nothing to observe, so this costs nothing.
      activity: null,
      preview: null,
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
