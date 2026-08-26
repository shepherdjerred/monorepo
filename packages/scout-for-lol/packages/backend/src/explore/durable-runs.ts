import * as Sentry from "@sentry/bun";
import { z } from "zod";
import {
  ExploreActiveRunSchema,
  ExploreRunSnapshotEventSchema,
  ExploreTraceEntrySchema,
  type DiscordAccountId,
  type ExploreActiveRun,
  type ExploreRunOutcome,
  type ExploreStreamEvent,
} from "@scout-for-lol/data";
import { scoutInteractiveWorkflowId } from "@scout-for-lol/temporal";
import { requestStopSignal } from "@scout-for-lol/temporal/signals";
import configuration from "#src/configuration.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { reserveDurableExploreRun } from "#src/temporal/durable-quota.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutInteractiveRun } from "#src/temporal/starts.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("explore-durable-runs");

type Subscriber = (event: ExploreStreamEvent) => void;

type StartedTurn = {
  conversationId: string;
  title: string;
  messageId: string;
  question: string;
  expectedCurrentLeafId: string | null;
  previousCurrentLeafId: string | null;
  createdConversation: boolean;
  createdQuestion: boolean;
};

export class DurableExploreUnavailableError extends Error {}

type DurableExploreRejection = {
  reason: string;
  retryAfterSeconds: number;
};

export async function reserveAndStartDurableExploreRun(input: {
  database: ExtendedPrismaClient;
  summary: ExploreActiveRun;
  ownerId: DiscordAccountId;
  started: StartedTurn;
  guildIds: string[];
}): Promise<DurableExploreRejection | null> {
  const rejection = await reserveDurableExploreRun({
    id: input.summary.runId,
    ownerId: input.ownerId,
    conversationId: input.summary.conversationId,
    payload: JSON.stringify({
      summary: input.summary,
      started: input.started,
      guildIds: input.guildIds,
    }),
  });
  if (rejection !== null) return rejection;
  try {
    const supervisor = currentScoutTemporalSupervisor();
    if (supervisor === undefined) {
      throw new DurableExploreUnavailableError("Temporal is unavailable");
    }
    await startScoutInteractiveRun(supervisor.client(), {
      stage: configuration.environment,
      kind: "explore",
      databaseRunId: input.summary.runId,
    });
  } catch (error) {
    // A client-side start error is ambiguous: Temporal may have accepted the
    // workflow while the response was lost. Keep the reservation PENDING so
    // the ingestion reconciler can reattach it instead of deleting the turn
    // or issuing a second provider request. Only a supervisor that was known
    // to be unavailable is terminalized immediately.
    if (error instanceof DurableExploreUnavailableError) {
      await input.database.scoutInteractiveRun.updateMany({
        where: { id: input.summary.runId, state: "PENDING" },
        data: {
          state: "FAILED",
          outcome: "failed",
          lastError: error.message,
          completedAt: new Date(),
        },
      });
    }
    throw error;
  }
  return null;
}

export async function listDurableExploreRuns(
  database: ExtendedPrismaClient,
  userId: DiscordAccountId,
  local: ExploreActiveRun[],
): Promise<ExploreActiveRun[]> {
  const localIds = new Set(local.map((run) => run.runId));
  const persisted = await database.scoutInteractiveRun.findMany({
    where: {
      kind: "explore",
      ownerId: userId,
      state: { in: ["PENDING", "RUNNING"] },
    },
    select: { id: true, payload: true },
    orderBy: { createdAt: "asc" },
  });
  for (const row of persisted) {
    if (localIds.has(row.id)) continue;
    const parsed = z
      .object({ summary: ExploreActiveRunSchema })
      .parse(JSON.parse(row.payload));
    local.push(parsed.summary);
  }
  return local.toSorted((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );
}

function outcomeForStatus(status: string): ExploreRunOutcome {
  if (status === "COMPLETED") return "succeeded";
  if (status === "CANCELLED") return "stopped";
  if (status === "INTERRUPTED") return "interrupted";
  return "failed";
}

export async function subscribeDurableExploreRun(
  database: ExtendedPrismaClient,
  runId: string,
  userId: DiscordAccountId,
  subscriber: Subscriber,
): Promise<(() => void) | null> {
  const initial = await database.scoutInteractiveRun.findFirst({
    where: { id: runId, kind: "explore", ownerId: userId },
  });
  if (initial === null) return null;

  let stopped = false;
  let reading = false;
  let lastPartial = "";
  let lastTrace = "[]";
  const emitRow = (row: typeof initial): boolean => {
    if (row.state !== "PENDING" && row.state !== "RUNNING") {
      subscriber({ type: "done", outcome: outcomeForStatus(row.state) });
      return true;
    }
    const parsed = z
      .object({ summary: ExploreActiveRunSchema })
      .parse(JSON.parse(row.payload));
    const trace = z
      .array(ExploreTraceEntrySchema)
      .parse(row.trace === null ? [] : JSON.parse(row.trace));
    lastPartial = row.partialOutput ?? "";
    lastTrace = row.trace ?? "[]";
    subscriber(
      ExploreRunSnapshotEventSchema.parse({
        type: "snapshot",
        ...parsed.summary,
        answer: lastPartial.length === 0 ? null : lastPartial,
        activity: row.state === "PENDING" ? "Waiting to start…" : "Thinking…",
        trace,
      }),
    );
    return false;
  };
  if (emitRow(initial)) {
    return () => {
      stopped = true;
    };
  }

  const poll = async (): Promise<void> => {
    try {
      const row = await database.scoutInteractiveRun.findUniqueOrThrow({
        where: { id: runId },
      });
      if (stopped) return;
      if (row.state !== "PENDING" && row.state !== "RUNNING") {
        stopped = true;
        clearInterval(timer);
        subscriber({ type: "done", outcome: outcomeForStatus(row.state) });
      } else if (
        (row.partialOutput ?? "") !== lastPartial ||
        (row.trace ?? "[]") !== lastTrace
      ) {
        emitRow(row);
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: "explore-durable-observer", runId },
      });
    } finally {
      reading = false;
    }
  };
  const timer = setInterval(() => {
    if (stopped || reading) return;
    reading = true;
    void poll();
  }, 1000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export async function requestDurableExploreStop(
  database: ExtendedPrismaClient,
  runId: string,
  userId: DiscordAccountId,
): Promise<boolean> {
  const durableRun = await database.scoutInteractiveRun.findFirst({
    where: {
      id: runId,
      kind: "explore",
      ownerId: userId,
      state: { in: ["PENDING", "RUNNING"] },
    },
    select: { id: true },
  });
  if (durableRun === null) return false;
  await database.scoutInteractiveRun.update({
    where: { id: runId },
    data: { stopRequestedAt: new Date() },
  });
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) return true;
  try {
    await supervisor
      .client()
      .workflow.getHandle(
        scoutInteractiveWorkflowId(configuration.environment, "explore", runId),
      )
      .signal(requestStopSignal);
  } catch (error) {
    logger.warn(
      "Explore stop persisted but the Temporal signal was not accepted; reconciliation will retry it",
      { runId, error },
    );
  }
  return true;
}

export async function durableExploreOutcome(
  database: ExtendedPrismaClient,
  runId: string,
  userId: DiscordAccountId,
): Promise<ExploreRunOutcome | null> {
  const run = await database.scoutInteractiveRun.findFirst({
    where: { id: runId, kind: "explore", ownerId: userId },
    select: { state: true },
  });
  if (run === null || run.state === "PENDING" || run.state === "RUNNING") {
    return null;
  }
  return outcomeForStatus(run.state);
}

export async function waitForDurableExploreRun(
  database: ExtendedPrismaClient,
  runId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs + 60_000;
  for (;;) {
    const run = await database.scoutInteractiveRun.findUniqueOrThrow({
      where: { id: runId },
      select: { state: true },
    });
    if (run.state !== "PENDING" && run.state !== "RUNNING") return;
    if (Date.now() >= deadline) {
      throw new Error(
        "Explore cancellation did not finish before its deadline",
      );
    }
    await Bun.sleep(250);
  }
}
