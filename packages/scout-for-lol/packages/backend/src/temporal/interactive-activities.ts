import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import {
  ExploreActiveRunSchema,
  ExploreRunOutcomeSchema,
  ExploreTraceEntrySchema,
} from "@scout-for-lol/data";
import type {
  InteractiveOutcome,
  ScoutInteractiveRunInput,
} from "@scout-for-lol/temporal";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { exploreRunManager } from "#src/explore/run-manager.ts";
import { persistPartialAnswer } from "#src/explore/partial-answer.ts";
import { scoutTemporalInterruptedProviderAttempts } from "#src/metrics/temporal.ts";
import type { ScoutInteractiveRun } from "#generated/prisma/client/index.js";

const ExplorePayloadSchema = z.strictObject({
  summary: ExploreActiveRunSchema,
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

async function runReportAiActivity(
  runId: string,
  database: ExtendedPrismaClient,
): Promise<InteractiveOutcome> {
  const { reportAiRuntime } =
    await import("#src/reports/ai/temporal-runtime.ts");
  const runtime = reportAiRuntime(runId);
  if (runtime === undefined) {
    throw new Error(
      `Report AI run ${runId} has no live execution adapter after its provider claim`,
    );
  }
  const cancellationSignal = Context.current().cancellationSignal;
  const cancel = (): void => {
    runtime.abortController.abort(
      "Report AI edit cancelled by its Temporal Workflow.",
    );
  };
  cancellationSignal.addEventListener("abort", cancel, { once: true });
  if (cancellationSignal.aborted) cancel();
  try {
    return await runUntilSettled({
      execution: runtime.execute(),
      intervalMs: 5000,
      heartbeat: async () => {
        const snapshot = await database.scoutInteractiveRun.findUniqueOrThrow({
          where: { id: runId },
          select: { partialOutput: true, stopRequestedAt: true },
        });
        if (snapshot.stopRequestedAt !== null) cancel();
        Context.current().heartbeat({
          runId,
          partialCharacters: snapshot.partialOutput?.length ?? 0,
        });
      },
    });
  } finally {
    cancellationSignal.removeEventListener("abort", cancel);
  }
}

async function runExploreActivity(
  runId: string,
  database: ExtendedPrismaClient,
): Promise<InteractiveOutcome> {
  const cancellationSignal = Context.current().cancellationSignal;
  const cancel = (): void => {
    exploreRunManager.cancelTemporal(
      runId,
      "Explore turn cancelled by its Temporal Workflow.",
    );
  };
  cancellationSignal.addEventListener("abort", cancel, { once: true });
  if (cancellationSignal.aborted) cancel();
  try {
    const outcome = await runUntilSettled({
      execution: exploreRunManager.executeTemporal(runId),
      intervalMs: 1000,
      heartbeat: async () => {
        const snapshot = exploreRunManager.snapshot(runId);
        const control = await database.scoutInteractiveRun.findUniqueOrThrow({
          where: { id: runId },
          select: { stopRequestedAt: true },
        });
        if (control.stopRequestedAt !== null) cancel();
        if (snapshot === undefined) return;
        await database.scoutInteractiveRun.update({
          where: { id: runId },
          data: {
            partialOutput: snapshot.answer,
            trace: JSON.stringify(snapshot.trace),
          },
        });
        Context.current().heartbeat({
          runId,
          partialCharacters: snapshot.answer.length,
          traceEntries: snapshot.trace.length,
        });
      },
    });
    const persisted = await database.scoutInteractiveRun.findUniqueOrThrow({
      where: { id: runId },
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

  if (run.kind === "explore") {
    const parsedPayload = ExplorePayloadSchema.parse(JSON.parse(run.payload));
    await exploreRunManager.rehydrateTemporalRun({
      summary: parsedPayload.summary,
      identity: { userId: run.ownerId },
      guildIds: parsedPayload.guildIds,
      started: parsedPayload.started,
    });
  } else {
    const { reportAiRuntime } =
      await import("#src/reports/ai/temporal-runtime.ts");
    if (reportAiRuntime(run.id) === undefined) {
      return {
        status: "interrupted",
        partialOutputAvailable: (run.partialOutput?.length ?? 0) > 0,
      };
    }
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
    return await runReportAiActivity(run.id, database);
  }
  return await runExploreActivity(run.id, database);
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
