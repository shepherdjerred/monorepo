import {
  ExploreActiveRunSchema,
  type ExploreActiveRun,
  type ExploreMessage,
  type ExploreTurnRequest,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { DiscordChannelId } from "@scout-for-lol/data";
import type { ExploreSurface } from "#src/explore/surface.ts";
import {
  getExploreQuotaStatus,
  type ExploreRateLimitIdentity,
  type ExploreRateLimitRejection,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import {
  ExploreNotFoundError,
  loadExploreTranscript,
  type ExploreTurnStoreClient,
} from "#src/explore/store.ts";
import { startReservedDurableExploreRun } from "#src/explore/runs/durable-runs.ts";
import {
  createDurableExploreRunReservation,
  durableExploreReservationRejection,
} from "#src/temporal/durable-quota.ts";
import {
  createActiveExploreRun,
  resolveTurnTarget,
} from "#src/explore/runs/run-manager-helpers.ts";
import type {
  ActiveRun,
  StartedTurn,
} from "#src/explore/runs/run-manager-types.ts";

type PreparedExploreRun = {
  started: StartedTurn;
  history: ExploreMessage[];
  summary: ExploreActiveRun;
};

async function prepareExploreRun(
  input: {
    identity: ExploreRateLimitIdentity;
    request: ExploreTurnRequest;
    conversationId: string;
    ticket: ExploreRateLimitTicket;
    surface: ExploreSurface;
    assertAcceptingRuns: () => void;
  },
  client: ExploreTurnStoreClient,
): Promise<PreparedExploreRun> {
  const started = await resolveTurnTarget({
    client,
    request: input.request,
    identity: input.identity,
    newId: input.conversationId,
    origin: input.surface,
  });
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
    input.identity.userId,
    started.messageId,
  );
  if (transcript === null) {
    throw new ExploreNotFoundError("Conversation not found.");
  }
  input.assertAcceptingRuns();
  const summary = ExploreActiveRunSchema.parse({
    runId: input.ticket.runId,
    conversationId: started.conversationId,
    questionMessageId: started.messageId,
    leafIdAtStart: started.expectedCurrentLeafId,
    versionCountAtStart,
    startedAt: new Date().toISOString(),
  });
  return { started, history: transcript.messages, summary };
}

export async function startExploreRun(input: {
  client: ExtendedPrismaClient;
  identity: ExploreRateLimitIdentity;
  request: ExploreTurnRequest;
  guildIds: string[];
  conversationId: string;
  ticket: ExploreRateLimitTicket;
  inlineExecutionForTests: boolean;
  surface: ExploreSurface;
  originChannelId: DiscordChannelId | null;
  assertAcceptingRuns: () => void;
  registerRun: (run: ActiveRun) => void;
  removeRun: (summary: ExploreActiveRun) => void;
  executeInline: (run: ActiveRun) => void;
  clearStartingConversation: () => void;
  createRateLimitedError: (rejection: ExploreRateLimitRejection) => Error;
  isDurableUnavailable: (error: unknown) => boolean;
  createUnavailableError: (error: unknown) => Error;
}): Promise<ExploreActiveRun> {
  const { client, identity, guildIds, ticket } = input;
  try {
    const prepared = input.inlineExecutionForTests
      ? await prepareExploreRun(input, client)
      : await prepareDurableExploreRun(input);
    const { started, history, summary } = prepared;
    const run = createActiveExploreRun({
      summary,
      identity,
      guildIds,
      ticket,
      started,
      history,
      surface: input.surface,
      originChannelId: input.originChannelId,
    });
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
    removeRun: (summary: ExploreActiveRun) => void;
    isDurableUnavailable: (error: unknown) => boolean;
    createUnavailableError: (error: unknown) => Error;
  },
  summary: ExploreActiveRun,
  started: StartedTurn,
): Promise<void> {
  try {
    await startReservedDurableExploreRun({
      database: input.client,
      summary,
      ownerId: input.identity.userId,
      started,
    });
  } catch (error) {
    input.removeRun(summary);
    if (input.isDurableUnavailable(error)) {
      throw input.createUnavailableError(error);
    }
    throw error;
  }
}

async function prepareDurableExploreRun(input: {
  client: ExtendedPrismaClient;
  identity: ExploreRateLimitIdentity;
  request: ExploreTurnRequest;
  conversationId: string;
  ticket: ExploreRateLimitTicket;
  guildIds: string[];
  surface: ExploreSurface;
  originChannelId: DiscordChannelId | null;
  assertAcceptingRuns: () => void;
  createRateLimitedError: (rejection: ExploreRateLimitRejection) => Error;
}): Promise<PreparedExploreRun> {
  const reservation = await input.client.$transaction(async (tx) => {
    const rejection = await durableExploreReservationRejection({
      database: tx,
      ownerId: input.identity.userId,
      conversationId: input.conversationId,
    });
    if (rejection !== null) {
      return { status: "rejected", rejection } as const;
    }
    const prepared = await prepareExploreRun(input, tx);
    await createDurableExploreRunReservation({
      database: tx,
      id: prepared.summary.runId,
      ownerId: input.identity.userId,
      conversationId: prepared.summary.conversationId,
      payload: JSON.stringify({
        summary: prepared.summary,
        started: prepared.started,
        guildIds: input.guildIds,
        surface: input.surface,
        originChannelId: input.originChannelId,
      }),
    });
    return { status: "prepared", prepared } as const;
  });
  if (reservation.status === "rejected") {
    throw input.createRateLimitedError({
      allowed: false,
      quota: getExploreQuotaStatus(input.identity).quota,
      ...reservation.rejection,
    });
  }
  return reservation.prepared;
}
