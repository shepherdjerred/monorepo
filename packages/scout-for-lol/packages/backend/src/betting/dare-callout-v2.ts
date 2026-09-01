import * as Sentry from "@sentry/bun";
import type { MessageCreateOptions, MessageEditOptions } from "discord.js";
import {
  BucksDareV2StateSchema,
  BucksMessageRefSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type BucksDareV2State,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { dareV2CalloutComponents } from "#src/betting/dare-components-v2.ts";
import { dareV2CalloutContent } from "#src/betting/dare-callout-content-v2.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { send } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-callout-v2");
const CALLOUT_CLAIM_STALE_MS = 10 * 60 * 1000;

export type DareV2MessageSender = (
  options: MessageCreateOptions,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId,
) => Promise<{ channelId: string; id: string }>;

export type DareV2MessageEditor = (input: {
  channelId: DiscordChannelId;
  messageId: string;
  options: MessageEditOptions;
}) => Promise<void>;

const defaultEditor: DareV2MessageEditor = async (input) => {
  const channel = await client.channels.fetch(input.channelId);
  if (channel?.isTextBased() !== true) {
    throw new Error(
      `Dare v2 channel ${input.channelId} is unavailable or not text based.`,
    );
  }
  await channel.messages.edit(input.messageId, input.options);
};

export type DareV2CalloutDependencies = {
  prismaClient: ExtendedPrismaClient;
  sendMessage: DareV2MessageSender;
  editMessage: DareV2MessageEditor;
};

export const defaultDareV2CalloutDependencies: DareV2CalloutDependencies = {
  prismaClient: prisma,
  sendMessage: send,
  editMessage: defaultEditor,
};

export type DareV2CalloutState = {
  id: number;
  serverId: string;
  channelId: string;
  messageRef: string | null;
  calloutRefreshVersion: number;
  state: BucksDareV2State;
  revision: number;
  challengerDiscordId: string;
  targetDiscordIds: string[];
  content: string;
};

export async function loadDareV2CalloutState(
  dareId: number,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<DareV2CalloutState | null> {
  const dare = await prismaClient.bucksDareV2.findUnique({
    where: { id: dareId },
    include: {
      revisions: { orderBy: { revision: "asc" } },
      targets: { orderBy: { id: "asc" } },
      _count: { select: { evidence: true } },
    },
  });
  if (dare === null) return null;
  const revisionNumber = dare.fundedRevision ?? dare.currentRevision;
  const revision = dare.revisions.find(
    (candidate) => candidate.revision === revisionNumber,
  );
  if (revision === undefined) {
    throw new Error(
      `Dare v2 ${dare.id.toString()} is missing revision ${revisionNumber.toString()}.`,
    );
  }
  const state = BucksDareV2StateSchema.parse(dare.dareState);
  return {
    id: dare.id,
    serverId: dare.serverId,
    channelId: dare.channelId,
    messageRef: dare.messageRef,
    calloutRefreshVersion: dare.calloutRefreshVersion,
    state,
    revision: revisionNumber,
    challengerDiscordId: dare.challengerDiscordId,
    targetDiscordIds: dare.targets.map((target) => target.discordId),
    content: dareV2CalloutContent({
      id: dare.id,
      challengerDiscordId: dare.challengerDiscordId,
      potTotal: dare.potTotal,
      targetAliases: dare.targets.map((target) => target.alias),
      revision: revisionNumber,
      plainLanguage: revision.plainLanguage,
      evidenceCount: dare._count.evidence,
      state,
      targets: dare.targets,
      acceptDeadline: dare.acceptDeadline,
      deadlineAt: dare.deadlineAt,
      finalValue: dare.finalValue,
      voidReason: dare.voidReason,
    }),
  };
}

export async function persistDareV2MessageRef(
  input: {
    dareId: number;
    claimId: string;
    calloutRefreshVersion: number;
    ref: { channelId: string; messageId: string };
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const persisted = await prismaClient.bucksDareV2.updateMany({
    where: {
      id: input.dareId,
      calloutClaimId: input.claimId,
      calloutRefreshVersion: input.calloutRefreshVersion,
      messageRef: null,
    },
    data: {
      messageRef: JSON.stringify(input.ref),
      calloutClaimId: null,
      calloutClaimedAt: null,
      calloutRefreshPending: false,
    },
  });
  if (persisted.count !== 1) {
    throw new Error(
      `Dare v2 ${input.dareId.toString()} lost its callout delivery claim.`,
    );
  }
}

export type DareV2CalloutPostResult =
  | { kind: "posted"; channelId: string; id: string }
  | { kind: "existing"; channelId: string; id: string }
  | { kind: "in_progress" };

export async function postDareV2Callout(
  dareId: number,
  dependencies: DareV2CalloutDependencies = defaultDareV2CalloutDependencies,
): Promise<DareV2CalloutPostResult> {
  return await runSerialized(
    `dare-v2-callout:${dareId.toString()}`,
    async () => {
      const existing = await dependencies.prismaClient.bucksDareV2.findUnique({
        where: { id: dareId },
        select: { messageRef: true },
      });
      if (existing === null)
        throw new Error(`Dare v2 ${dareId.toString()} not found.`);
      if (existing.messageRef !== null) {
        const ref = BucksMessageRefSchema.parse(
          JSON.parse(existing.messageRef),
        );
        return {
          kind: "existing",
          channelId: ref.channelId,
          id: ref.messageId,
        };
      }

      const claimId = globalThis.crypto.randomUUID();
      const now = new Date();
      const claimed = await dependencies.prismaClient.bucksDareV2.updateMany({
        where: {
          id: dareId,
          messageRef: null,
          OR: [
            { calloutClaimId: null },
            {
              calloutClaimedAt: {
                lt: new Date(now.getTime() - CALLOUT_CLAIM_STALE_MS),
              },
            },
          ],
        },
        data: { calloutClaimId: claimId, calloutClaimedAt: now },
      });
      if (claimed.count !== 1) return { kind: "in_progress" };

      try {
        const state = await loadDareV2CalloutState(
          dareId,
          dependencies.prismaClient,
        );
        if (state === null)
          throw new Error(`Dare v2 ${dareId.toString()} not found.`);
        const message = await observeBucksDelivery(
          {
            surface: "dare_callout",
            operation: "send",
            serverId: state.serverId,
            channelId: state.channelId,
          },
          async () =>
            await dependencies.sendMessage(
              {
                // Discord deduplicates a retried create with the same nonce
                // when enforceNonce is true. This closes the send-succeeded /
                // database-persist-failed window without making settlement
                // depend on message delivery.
                nonce: `dare-v2-${state.id.toString()}`,
                enforceNonce: true,
                content: state.content,
                components: dareV2CalloutComponents({
                  state: state.state,
                  dareId: state.id,
                  revision: state.revision,
                }),
                allowedMentions: {
                  parse: [],
                  users: [state.challengerDiscordId, ...state.targetDiscordIds],
                },
              },
              DiscordChannelIdSchema.parse(state.channelId),
              DiscordGuildIdSchema.parse(state.serverId),
            ),
        );
        await persistDareV2MessageRef(
          {
            dareId,
            claimId,
            calloutRefreshVersion: state.calloutRefreshVersion,
            ref: { channelId: message.channelId, messageId: message.id },
          },
          dependencies.prismaClient,
        );
        return { kind: "posted", channelId: message.channelId, id: message.id };
      } catch (error) {
        await dependencies.prismaClient.bucksDareV2.updateMany({
          where: { id: dareId, calloutClaimId: claimId, messageRef: null },
          data: { calloutClaimId: null, calloutClaimedAt: null },
        });
        throw error;
      }
    },
  );
}

export async function refreshDareV2Callout(
  dareId: number,
  dependencies: DareV2CalloutDependencies = defaultDareV2CalloutDependencies,
): Promise<void> {
  await runSerialized(`dare-v2:${dareId.toString()}`, async () => {
    try {
      const state = await loadDareV2CalloutState(
        dareId,
        dependencies.prismaClient,
      );
      if (state?.messageRef == null) return;
      const ref = BucksMessageRefSchema.parse(JSON.parse(state.messageRef));
      await observeBucksDelivery(
        {
          surface: "dare_update",
          operation: "edit",
          serverId: state.serverId,
          channelId: ref.channelId,
        },
        async () => {
          await dependencies.editMessage({
            channelId: DiscordChannelIdSchema.parse(ref.channelId),
            messageId: ref.messageId,
            options: {
              content: state.content,
              components: dareV2CalloutComponents({
                state: state.state,
                dareId: state.id,
                revision: state.revision,
              }),
              allowedMentions: { parse: [] },
            },
          });
        },
      );
      await dependencies.prismaClient.bucksDareV2.updateMany({
        where: {
          id: state.id,
          calloutRefreshPending: true,
          calloutRefreshVersion: state.calloutRefreshVersion,
        },
        data: { calloutRefreshPending: false },
      });
    } catch (error) {
      logger.error(
        `Could not refresh Dare v2 ${dareId.toString()} callout:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "betting-dare-v2-refresh", dareId: dareId.toString() },
      });
      throw error;
    }
  });
}

export async function refreshDareV2Callouts(
  dareIds: readonly number[],
  dependencies: DareV2CalloutDependencies = defaultDareV2CalloutDependencies,
): Promise<void> {
  await Promise.all(
    [...new Set(dareIds)].map(async (dareId) => {
      await refreshDareV2Callout(dareId, dependencies);
    }),
  );
}

export async function refreshPendingDareV2Callouts(
  dependencies: DareV2CalloutDependencies = defaultDareV2CalloutDependencies,
): Promise<number[]> {
  const pending = await dependencies.prismaClient.bucksDareV2.findMany({
    where: { calloutRefreshPending: true, messageRef: { not: null } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const dareIds = pending.map((dare) => dare.id);
  await refreshDareV2Callouts(dareIds, dependencies);
  return dareIds;
}

export async function ensureDareV2Callout(
  dareId: number,
  dependencies: DareV2CalloutDependencies = defaultDareV2CalloutDependencies,
): Promise<"posted" | "existing" | "in_progress" | "refreshed" | "draft"> {
  const dare = await dependencies.prismaClient.bucksDareV2.findUnique({
    where: { id: dareId },
    select: { dareState: true, messageRef: true },
  });
  if (dare === null) throw new Error(`Dare v2 ${dareId.toString()} not found.`);
  if (dare.dareState === "draft") return "draft";
  if (dare.messageRef === null) {
    const result = await postDareV2Callout(dareId, dependencies);
    return result.kind;
  }
  await refreshDareV2Callout(dareId, dependencies);
  return "refreshed";
}

export async function tryEnsureDareV2Callout(
  dareId: number,
  dependencies: DareV2CalloutDependencies = defaultDareV2CalloutDependencies,
): Promise<
  "posted" | "existing" | "in_progress" | "refreshed" | "draft" | "failed"
> {
  try {
    return await ensureDareV2Callout(dareId, dependencies);
  } catch (error) {
    logger.error(
      `Could not ensure Dare v2 ${dareId.toString()} callout:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "betting-dare-v2-delivery", dareId: dareId.toString() },
    });
    return "failed";
  }
}
