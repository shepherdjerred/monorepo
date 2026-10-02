import {
  ExploreActiveRunSchema,
  EXPLORE_TIMEOUT_MS,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getExploreQuotaStatus } from "#src/explore/rate-limit.ts";
import {
  durableExploreOutcome,
  startReservedDurableExploreRun,
  waitForDurableExploreRun,
} from "#src/explore/runs/durable-runs.ts";
import { ExploreDurablePayloadSchema } from "#src/explore/runs/durable-payload.ts";
import { ExploreRunRateLimitedError } from "#src/explore/runs/run-manager.ts";
import type {
  runPersistedExploreTurn,
  ExplorePersistedTurnResult,
} from "#src/explore/runs/run-turn.ts";
import { loadExploreRunResult } from "#src/explore/store.ts";
import { reserveDurableExploreRun } from "#src/temporal/durable-quota.ts";

type DiscordTurnInput = Parameters<typeof runPersistedExploreTurn>[0];

/** Discord transports observe the same durable execution as web and voice. */
export async function runDurableDiscordExploreTurn(
  input: DiscordTurnInput,
  database: ExtendedPrismaClient = prisma,
  dependencies: { startRun?: typeof startReservedDurableExploreRun } = {},
): Promise<ExplorePersistedTurnResult> {
  try {
    const summary = ExploreActiveRunSchema.parse({
      runId: input.ticket.runId,
      conversationId: input.started.conversationId,
      questionMessageId: input.started.messageId,
      leafIdAtStart: input.started.expectedCurrentLeafId,
      versionCountAtStart: await database.exploreMessage.count({
        where: {
          conversationId: input.started.conversationId,
          parentId: input.started.messageId,
          role: "assistant",
        },
      }),
      startedAt: new Date().toISOString(),
    });
    const payload = ExploreDurablePayloadSchema.parse({
      summary,
      started: input.started,
      guildIds: input.guildIds,
      surface: input.surface,
      originChannelId: input.originChannelId ?? null,
    });
    const rejection = await reserveDurableExploreRun({
      database,
      id: summary.runId,
      ownerId: input.identity.userId,
      conversationId: summary.conversationId,
      payload: JSON.stringify(payload),
    });
    if (rejection !== null) {
      throw new ExploreRunRateLimitedError({
        allowed: false,
        quota: getExploreQuotaStatus(input.identity).quota,
        ...rejection,
      });
    }
    input.ticket.commit();
    await (dependencies.startRun ?? startReservedDurableExploreRun)({
      database,
      summary,
      ownerId: input.identity.userId,
      started: payload.started,
    });
    await waitForDurableExploreRun(database, summary.runId, EXPLORE_TIMEOUT_MS);
    const outcome = await durableExploreOutcome(
      database,
      summary.runId,
      input.identity.userId,
    );
    if (outcome === null) {
      throw new Error(`Explore run ${summary.runId} has no terminal outcome`);
    }
    const result = await loadExploreRunResult(database, {
      runId: summary.runId,
      conversationId: summary.conversationId,
      userId: input.identity.userId,
    });
    if (result !== null)
      return {
        type: "final",
        message: result.answer,
        title: input.started.title,
        quota: getExploreQuotaStatus(input.identity).quota,
        outcome,
      };
    if (outcome === "succeeded") {
      throw new Error(
        `Succeeded Explore run ${summary.runId} has no saved answer`,
      );
    }
    return {
      type: "error",
      message:
        "Scout could not finish this answer. Your question is saved in Explore.",
      outcome,
      retryAfterSeconds: null,
      quota: null,
    };
  } finally {
    input.ticket.finish();
  }
}
