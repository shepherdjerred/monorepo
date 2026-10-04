import * as Sentry from "@sentry/bun";
import type { MessageCreateOptions, MessageEditOptions } from "discord.js";
import {
  BucksDareStateSchema,
  BucksMessageRefSchema,
  DareSqlCompilationSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type BucksDareState,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { dareCalloutComponents } from "#src/betting/dares/presentation/dare-components.ts";
import { renderDareCallout } from "#src/betting/dares/presentation/dare-callout-content.ts";
import { deriveDareProgress } from "#src/betting/dares/presentation/dare-progress.ts";
import { observeBucksDelivery } from "#src/betting/notify/delivery-observability.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { send } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-callout-v2");
const CALLOUT_CLAIM_STALE_MS = 10 * 60 * 1000;
const MAX_ALLOWED_MENTION_USERS = 100;

export type DareMessageSender = (
  options: MessageCreateOptions,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId,
) => Promise<{ channelId: string; id: string }>;

export type DareMessageEditor = (input: {
  channelId: DiscordChannelId;
  messageId: string;
  options: MessageEditOptions;
}) => Promise<void>;

const defaultEditor: DareMessageEditor = async (input) => {
  const channel = await fetchChannelForDelivery(input.channelId);
  if (channel?.isTextBased() !== true) {
    throw new Error(
      `Dare channel ${input.channelId} is unavailable or not text based.`,
    );
  }
  await channel.messages.edit(input.messageId, input.options);
};

export type DareCalloutDependencies = {
  prismaClient: ExtendedPrismaClient;
  sendMessage: DareMessageSender;
  editMessage: DareMessageEditor;
  /**
   * Whether a Dare with no callout yet may have one POSTED. Defaults to yes,
   * which is v1's behaviour and the behaviour of every caller that does not
   * care.
   *
   * Only the post branch asks. Editing a callout that already exists is
   * allowed unconditionally: withholding it would leave an already-public
   * message stale and wrong, which is a different harm rather than a smaller
   * one, and the message it edits was posted by a live discovery that was
   * entitled to post it.
   */
  mayPost?: (() => boolean) | undefined;
  /**
   * Reads `dare_notifications_enabled` to decide whether a resolved Dare's
   * result post will actually go out, and so whether the scan must leave its
   * terminal callout edit to the post's follow-up. Defaults to the real
   * policy.
   */
  isPolicyEnabled?: typeof isPolicyEnabled | undefined;
};

export const defaultDareCalloutDependencies: DareCalloutDependencies = {
  prismaClient: prisma,
  sendMessage: send,
  editMessage: defaultEditor,
};

export type DareCalloutState = {
  id: number;
  serverId: string;
  channelId: string;
  messageRef: string | null;
  calloutRefreshVersion: number;
  state: BucksDareState;
  revision: number;
  challengerDiscordId: string;
  targetDiscordIds: string[];
  contributorDiscordIds: string[];
  content: string;
};

function allowedMentionUsers(
  state: DareCalloutState,
  includeTargets: boolean,
): string[] {
  return [
    ...new Set([
      state.challengerDiscordId,
      ...state.contributorDiscordIds,
      ...(includeTargets ? state.targetDiscordIds : []),
    ]),
  ].slice(0, MAX_ALLOWED_MENTION_USERS);
}

export async function loadDareCalloutState(
  dareId: number,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<DareCalloutState | null> {
  const dare = await prismaClient.bucksDare.findUnique({
    where: { id: dareId },
    include: {
      revisions: { orderBy: { revision: "asc" } },
      targets: { orderBy: { id: "asc" } },
      contributions: {
        orderBy: { id: "asc" },
        select: { discordId: true, amount: true },
      },
      evidence: {
        orderBy: [{ gameEndAt: "asc" }, { matchId: "asc" }],
      },
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
      `Dare ${dare.id.toString()} is missing revision ${revisionNumber.toString()}.`,
    );
  }
  const state = BucksDareStateSchema.parse(dare.dareState);
  const targetKeys = dare.targets.map((target) => target.targetKey);
  const final = !["draft", "pending_accept", "activating", "active"].includes(
    state,
  );
  const progress = deriveDareProgress({
    compilation: DareSqlCompilationSchema.parse(
      JSON.parse(revision.compiledPlan),
    ),
    evidence: dare.evidence,
    targetKeys,
    final,
    finalityReason: state,
    settledValue: dare.finalValue,
  });
  const rendered = renderDareCallout({
    id: dare.id,
    challengerDiscordId: dare.challengerDiscordId,
    openingStake: dare.openingStake,
    potTotal: dare.potTotal,
    contributions: dare.contributions,
    targetAliases: dare.targets.map((target) => target.alias),
    revision: revisionNumber,
    plainLanguage: revision.plainLanguage,
    evidenceCount: dare._count.evidence,
    progressSummary: progress.summary,
    state,
    targets: dare.targets,
    acceptDeadline: dare.acceptDeadline,
    deadlineAt: dare.deadlineAt,
    finalValue: dare.finalValue,
    voidReason: dare.voidReason,
  });
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
    contributorDiscordIds: rendered.contributorDiscordIds,
    content: rendered.content,
  };
}

export async function persistDareMessageRef(
  input: {
    dareId: number;
    claimId: string;
    calloutRefreshVersion: number;
    ref: { channelId: string; messageId: string };
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const persisted = await prismaClient.bucksDare.updateMany({
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
      `Dare ${input.dareId.toString()} lost its callout delivery claim.`,
    );
  }
}

export type DareCalloutPostResult =
  | { kind: "posted"; channelId: string; id: string }
  | { kind: "existing"; channelId: string; id: string }
  | { kind: "in_progress" };

export async function postDareCallout(
  dareId: number,
  dependencies: DareCalloutDependencies = defaultDareCalloutDependencies,
): Promise<DareCalloutPostResult> {
  return await runSerialized(
    `dare-v2-callout:${dareId.toString()}`,
    async () => {
      const existing = await dependencies.prismaClient.bucksDare.findUnique({
        where: { id: dareId },
        select: { messageRef: true },
      });
      if (existing === null)
        throw new Error(`Dare ${dareId.toString()} not found.`);
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
      const claimed = await dependencies.prismaClient.bucksDare.updateMany({
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
        const state = await loadDareCalloutState(
          dareId,
          dependencies.prismaClient,
        );
        if (state === null)
          throw new Error(`Dare ${dareId.toString()} not found.`);
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
                components: dareCalloutComponents({
                  state: state.state,
                  dareId: state.id,
                  revision: state.revision,
                }),
                allowedMentions: {
                  parse: [],
                  users: allowedMentionUsers(state, true),
                },
              },
              DiscordChannelIdSchema.parse(state.channelId),
              DiscordGuildIdSchema.parse(state.serverId),
            ),
        );
        await persistDareMessageRef(
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
        await dependencies.prismaClient.bucksDare.updateMany({
          where: { id: dareId, calloutClaimId: claimId, messageRef: null },
          data: { calloutClaimId: null, calloutClaimedAt: null },
        });
        throw error;
      }
    },
  );
}

export async function refreshDareCallout(
  dareId: number,
  dependencies: DareCalloutDependencies = defaultDareCalloutDependencies,
): Promise<void> {
  await runSerialized(`dare-v2:${dareId.toString()}`, async () => {
    try {
      const state = await loadDareCalloutState(
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
              components: dareCalloutComponents({
                state: state.state,
                dareId: state.id,
                revision: state.revision,
              }),
              allowedMentions: {
                parse: [],
                users: allowedMentionUsers(state, false),
              },
            },
          });
        },
      );
      await dependencies.prismaClient.bucksDare.updateMany({
        where: {
          id: state.id,
          calloutRefreshPending: true,
          calloutRefreshVersion: state.calloutRefreshVersion,
        },
        data: { calloutRefreshPending: false },
      });
    } catch (error) {
      logger.error(
        `Could not refresh Dare ${dareId.toString()} callout:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "betting-dare-v2-refresh", dareId: dareId.toString() },
      });
      throw error;
    }
  });
}

export async function refreshDareCallouts(
  dareIds: readonly number[],
  dependencies: DareCalloutDependencies = defaultDareCalloutDependencies,
): Promise<void> {
  await Promise.all(
    [...new Set(dareIds)].map(async (dareId) => {
      await refreshDareCallout(dareId, dependencies);
    }),
  );
}

/** Result-post states that may still reach Discord and run the follow-up. */
const OWED_RESULT_POST_STATES = ["pending", "ready", "sending"];

/**
 * The pending Dares whose channel result post has not gone out yet and will.
 *
 * A resolved Dare's callout is edited to its final state by the result post's
 * follow-up, once Discord accepted the post, so the channel reads result first
 * and resolved callout second. A scan that edited it beforehand would invert
 * that. A post the guild's flag will suppress never runs the follow-up, so its
 * Dare keeps the scan's immediate edit; so does one already delivered,
 * suppressed, expired, or left ambiguous for an operator.
 */
async function daresAwaitingResultPost(
  pending: readonly { id: number; serverId: DiscordGuildId }[],
  dependencies: DareCalloutDependencies,
): Promise<Set<number>> {
  if (pending.length === 0) return new Set();
  const owed = await dependencies.prismaClient.matchNotificationIntent.findMany(
    {
      where: {
        kind: "dare-status",
        subjectKind: "dare",
        subjectId: { in: pending.map((dare) => dare.id.toString()) },
        targetKind: "channel",
        state: { in: OWED_RESULT_POST_STATES },
      },
      select: { subjectId: true },
    },
  );
  const owedIds = new Set(owed.map((row) => Number(row.subjectId)));
  const policy = dependencies.isPolicyEnabled ?? isPolicyEnabled;
  const awaiting = new Set<number>();
  for (const dare of pending) {
    if (
      owedIds.has(dare.id) &&
      (await policy("dare_notifications_enabled", { server: dare.serverId }))
    ) {
      awaiting.add(dare.id);
    }
  }
  return awaiting;
}

export async function refreshPendingDareCallouts(
  dependencies: DareCalloutDependencies = defaultDareCalloutDependencies,
): Promise<number[]> {
  const pending = await dependencies.prismaClient.bucksDare.findMany({
    where: { calloutRefreshPending: true },
    orderBy: { id: "asc" },
    select: { id: true, serverId: true },
  });
  const awaitingResultPost = await daresAwaitingResultPost(
    pending,
    dependencies,
  );
  const dareIds = pending
    .map((dare) => dare.id)
    .filter((dareId) => !awaitingResultPost.has(dareId));
  await Promise.all(
    dareIds.map(async (dareId) => {
      await ensureDareCallout(dareId, dependencies);
    }),
  );
  return dareIds;
}

export async function ensureDareCallout(
  dareId: number,
  dependencies: DareCalloutDependencies = defaultDareCalloutDependencies,
): Promise<
  "posted" | "existing" | "in_progress" | "refreshed" | "draft" | "withheld"
> {
  const dare = await dependencies.prismaClient.bucksDare.findUnique({
    where: { id: dareId },
    select: { dareState: true, messageRef: true },
  });
  if (dare === null) throw new Error(`Dare ${dareId.toString()} not found.`);
  if (dare.dareState === "draft") return "draft";
  if (dare.messageRef === null) {
    // Nothing is public for this Dare yet, so this branch would POST. A match
    // owed no public delivery withholds it; there is nothing to edit and
    // nothing is left half-done, because a Dare with no callout is exactly the
    // state it was already in.
    // Withheld, and nothing is retired from here. The scan this runs under
    // selects every globally pending Dare, so a decision about one match must
    // not write to rows that match never touched; the Dare a silent match
    // DID resolve has its pending callout retired inside that settlement's
    // own transaction. See `withholdDareCallout`.
    if (dependencies.mayPost?.() === false) return "withheld";
    const result = await postDareCallout(dareId, dependencies);
    return result.kind;
  }
  await refreshDareCallout(dareId, dependencies);
  return "refreshed";
}

export async function tryEnsureDareCallout(
  dareId: number,
  dependencies: DareCalloutDependencies = defaultDareCalloutDependencies,
): Promise<
  | "posted"
  | "existing"
  | "in_progress"
  | "refreshed"
  | "draft"
  | "withheld"
  | "failed"
> {
  try {
    return await ensureDareCallout(dareId, dependencies);
  } catch (error) {
    logger.error(`Could not ensure Dare ${dareId.toString()} callout:`, error);
    Sentry.captureException(error, {
      tags: { source: "betting-dare-v2-delivery", dareId: dareId.toString() },
    });
    return "failed";
  }
}
