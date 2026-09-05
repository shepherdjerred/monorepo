import {
  ExploreActiveRunSchema,
  type ExploreActiveRun,
  type ExploreTurnRequest,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  getExploreQuotaStatus,
  type ExploreRateLimitIdentity,
  type ExploreRateLimitRejection,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import {
  ExploreNotFoundError,
  loadExploreTranscript,
} from "#src/explore/store.ts";
import { rollbackUnstartedExploreTurn } from "#src/explore/rollback.ts";
import { reserveAndStartDurableExploreRun } from "#src/explore/durable-runs.ts";
import {
  resolveTurnTarget,
  createDeferred,
} from "#src/explore/run-manager-helpers.ts";
import type { ActiveRun, StartedTurn } from "#src/explore/run-manager-types.ts";

export async function startExploreRun(input: {
  client: ExtendedPrismaClient;
  identity: ExploreRateLimitIdentity;
  request: ExploreTurnRequest;
  guildIds: string[];
  conversationId: string;
  ticket: ExploreRateLimitTicket;
  inlineExecutionForTests: boolean;
  assertAcceptingRuns: () => void;
  registerRun: (run: ActiveRun) => void;
  removeRun: (summary: ExploreActiveRun) => void;
  executeInline: (run: ActiveRun) => void;
  clearStartingConversation: () => void;
  createRateLimitedError: (rejection: ExploreRateLimitRejection) => Error;
  isDurableUnavailable: (error: unknown) => boolean;
  isRateLimited: (error: unknown) => boolean;
  createUnavailableError: (error: unknown) => Error;
}): Promise<ExploreActiveRun> {
  const { client, identity, request, guildIds, conversationId, ticket } = input;
  try {
    const started = await resolveTurnTarget(
      client,
      request,
      identity,
      conversationId,
    );
    const versionCountAtStart = await client.exploreMessage.count({
      where: {
        conversationId: started.conversationId,
        parentId: started.messageId,
        role: "assistant",
      },
    });
    const transcript = await loadExploreTranscript(
      client,
      started.conversationId,
      identity.userId,
      started.messageId,
    );
    if (transcript === null) {
      throw new ExploreNotFoundError("Conversation not found.");
    }
    input.assertAcceptingRuns();
    const summary = ExploreActiveRunSchema.parse({
      runId: ticket.runId,
      conversationId: started.conversationId,
      questionMessageId: started.messageId,
      leafIdAtStart: started.expectedCurrentLeafId,
      versionCountAtStart,
      startedAt: new Date().toISOString(),
    });
    const deferred = createDeferred();
    const run: ActiveRun = {
      summary,
      identity,
      guildIds,
      ticket,
      started,
      history: transcript.messages,
      abortController: new AbortController(),
      subscribers: new Set(),
      answer: "",
      activity: "Thinking…",
      trace: [],
      termination: null,
      settled: deferred.promise,
      resolveSettled: deferred.resolve,
    };
    input.registerRun(run);
    if (input.inlineExecutionForTests) {
      input.executeInline(run);
    } else {
      await startDurableRun(input, summary, started);
    }
    return summary;
  } finally {
    input.clearStartingConversation();
  }
}

async function startDurableRun(
  input: {
    client: ExtendedPrismaClient;
    identity: ExploreRateLimitIdentity;
    guildIds: string[];
    removeRun: (summary: ExploreActiveRun) => void;
    createRateLimitedError: (rejection: ExploreRateLimitRejection) => Error;
    isDurableUnavailable: (error: unknown) => boolean;
    isRateLimited: (error: unknown) => boolean;
    createUnavailableError: (error: unknown) => Error;
  },
  summary: ExploreActiveRun,
  started: StartedTurn,
): Promise<void> {
  try {
    const durableRejection = await reserveAndStartDurableExploreRun({
      database: input.client,
      summary,
      ownerId: input.identity.userId,
      started,
      guildIds: input.guildIds,
      // Durable Explore runs are only ever enqueued from the Explore page.
      surface: "web",
    });
    if (durableRejection !== null) {
      throw input.createRateLimitedError({
        allowed: false,
        quota: getExploreQuotaStatus(input.identity).quota,
        ...durableRejection,
      });
    }
  } catch (error) {
    if (input.isDurableUnavailable(error) || input.isRateLimited(error)) {
      await rollbackUnstartedExploreTurn(input.client, {
        ...started,
        userId: input.identity.userId,
      });
    }
    input.removeRun(summary);
    if (input.isDurableUnavailable(error)) {
      throw input.createUnavailableError(error);
    }
    throw error;
  }
}
