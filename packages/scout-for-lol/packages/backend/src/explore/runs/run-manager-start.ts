import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import {
  ExploreActiveRunSchema,
  type ExploreActiveRun,
  type ExploreMessage,
  type ExploreTurnRequest,
  type DiscordChannelId,
} from "@scout-for-lol/data";
import { recordCoachTurn, type CoachTurnRecord } from "#src/coach/audit.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { coachRunSettings } from "#src/coach/execution-profile.ts";
import { ExploreDurablePayloadSchema } from "#src/explore/runs/durable-payload.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";
import {
  type ExploreRateLimitIdentity,
  type ExploreRateLimitRejection,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import {
  ExploreNotFoundError,
  loadExploreTranscript,
  type ExploreTurnStoreClient,
  ExploreInvalidTurnError,
} from "#src/explore/store.ts";
import { startReservedDurableExploreRun } from "#src/explore/runs/durable-runs.ts";
import {
  createDurableExploreRunReservation,
  durableExploreReservationRejection,
  durableExploreQuotaStatus,
} from "#src/temporal/durable-quota.ts";
import {
  createActiveExploreRun,
  resolveTurnTarget,
} from "#src/explore/runs/run-manager-helpers.ts";
import type {
  ActiveRun,
  StartedTurn,
} from "#src/explore/runs/run-manager-types.ts";
import {
  exploreModelPickerEnabled,
  resolveExploreModel,
} from "#src/config/dynamic.ts";

type PreparedExploreRun = {
  started: StartedTurn;
  history: ExploreMessage[];
  summary: ExploreActiveRun;
};

/** Fast local admission failures still report the durable question counts. */
export async function refreshExploreRejectionQuota(
  client: ExtendedPrismaClient,
  identity: ExploreRateLimitIdentity,
  rejection: ExploreRateLimitRejection,
) {
  const { quota } = await durableExploreQuotaStatus(
    identity.userId,
    Date.now(),
    client,
  );
  return { ...rejection, quota };
}

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
  if (input.request.model !== undefined && !exploreModelPickerEnabled()) {
    throw new ExploreInvalidTurnError("Model selection is not enabled.");
  }
  const started = await resolveTurnTarget({
    client,
    request: input.request,
    identity: input.identity,
    newId: input.conversationId,
    origin: input.surface,
  });
  const conversation = await client.exploreConversation.findUniqueOrThrow({
    where: { id: started.conversationId },
  });
  started.model = resolveExploreModel(
    input.request.model,
    conversation.preferredModel,
  );
  if (input.request.model !== undefined) {
    await client.exploreConversation.update({
      where: { id: started.conversationId },
      data: { preferredModel: input.request.model },
    });
  }
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

/**
 * The `ScoutInteractiveRun.payload` a durable turn is reserved with. A coach
 * turn carries only what its projection let through.
 */
export function durableExplorePayload(input: {
  summary: ExploreActiveRun;
  started: StartedTurn;
  guildIds: DiscordGuildId[];
  surface: ExploreSurface;
  originChannelId: DiscordChannelId | null;
  coach: CoachTurnRecord | null;
}): string {
  const context = input.coach?.projection.context ?? null;
  return JSON.stringify(
    ExploreDurablePayloadSchema.parse({
      summary: input.summary,
      started: input.started,
      guildIds: input.guildIds,
      surface: input.surface,
      originChannelId: input.originChannelId,
      coach: context === null ? null : { context },
    }),
  );
}

export async function startExploreRun(input: {
  client: ExtendedPrismaClient;
  identity: ExploreRateLimitIdentity;
  request: ExploreTurnRequest;
  guildIds: DiscordGuildId[];
  conversationId: string;
  ticket: ExploreRateLimitTicket;
  inlineExecutionForTests: boolean;
  surface: ExploreSurface;
  originChannelId: DiscordChannelId | null;
  coach: CoachTurnRecord | null;
  assertAcceptingRuns: () => void;
  registerRun: (run: ActiveRun) => void;
  removeRun: (summary: ExploreActiveRun) => void;
  executeInline: (run: ActiveRun) => void;
  clearStartingConversation: () => void;
  createRateLimitedError: (rejection: ExploreRateLimitRejection) => Error;
  isDurableUnavailable: (error: unknown) => boolean;
  createUnavailableError: (error: unknown) => Error;
}): Promise<ExploreActiveRun> {
  const { identity, guildIds, ticket } = input;
  try {
    const prepared = input.inlineExecutionForTests
      ? await prepareInlineExploreRun(input)
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
      coach: input.coach?.projection.context ?? null,
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

/** Tests run inline, with no reservation row; the audit row still lands. */
async function prepareInlineExploreRun(
  input: Parameters<typeof prepareExploreRun>[0] & {
    client: ExtendedPrismaClient;
    coach: CoachTurnRecord | null;
  },
): Promise<PreparedExploreRun> {
  const prepared = await prepareExploreRun(input, input.client);
  if (input.coach !== null) {
    await recordCoachTurn(input.client, {
      ownerId: input.identity.userId,
      run: prepared.summary,
      record: input.coach,
    });
  }
  return prepared;
}

async function prepareDurableExploreRun(input: {
  client: ExtendedPrismaClient;
  identity: ExploreRateLimitIdentity;
  request: ExploreTurnRequest;
  conversationId: string;
  ticket: ExploreRateLimitTicket;
  guildIds: DiscordGuildId[];
  surface: ExploreSurface;
  originChannelId: DiscordChannelId | null;
  coach: CoachTurnRecord | null;
  assertAcceptingRuns: () => void;
  createRateLimitedError: (rejection: ExploreRateLimitRejection) => Error;
}): Promise<PreparedExploreRun> {
  // A turn the in-game profile runs (champion select or a live game) spends
  // the in-game allowance instead of Explore's question windows.
  const { quota: allowance } = coachRunSettings(
    input.coach?.projection.context,
  );
  const reservation = await input.client.$transaction(async (tx) => {
    const rejection = await durableExploreReservationRejection({
      database: tx,
      ownerId: input.identity.userId,
      conversationId: input.conversationId,
      allowance,
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
      payload: durableExplorePayload({ ...input, ...prepared }),
      allowance,
    });
    // The audit row commits with the reservation or not at all, so no coach
    // turn is ever started without its record.
    if (input.coach !== null) {
      await recordCoachTurn(tx, {
        ownerId: input.identity.userId,
        run: prepared.summary,
        record: input.coach,
      });
    }
    return { status: "prepared", prepared } as const;
  });
  if (reservation.status === "rejected") {
    const status = await durableExploreQuotaStatus(
      input.identity.userId,
      Date.now(),
      input.client,
    );
    throw input.createRateLimitedError({
      allowed: false,
      quota: status.quota,
      ...reservation.rejection,
    });
  }
  return reservation.prepared;
}
