import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { User } from "#generated/prisma/client/index.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  ExploreConversationIdSchema,
  ExploreConversationTitleSchema,
  ExploreRunIdSchema,
  ExploreRunObserveRequestSchema,
  ExploreRunOutcomeResultSchema,
  ExploreTurnRequestSchema,
} from "@scout-for-lol/data";
import {
  inspectVisibleDareV2,
  listVisibleDaresV2,
} from "#src/betting/dare-view-v2.ts";
import { consumeDareV2ConfirmationIntent } from "#src/betting/dare-intent-consume-v2.ts";
import { tryEnsureDareV2Callout } from "#src/betting/dare-callout-v2.ts";
import { prisma } from "#src/database/index.ts";
import {
  assertExploreAccess,
  isExploreConfigured,
} from "#src/explore/access.ts";
import {
  ExploreConversationBusyError,
  getExploreQuotaStatus,
} from "#src/explore/rate-limit.ts";
import {
  ExploreRunRateLimitedError,
  ExploreRunUnavailableError,
  exploreRunManager,
} from "#src/explore/run-manager.ts";
import {
  ExploreInvalidTurnError,
  ExploreNotFoundError,
  listExploreConversations,
  loadExploreTranscript,
  renameExploreConversation,
  revokeExploreShare,
  setExploreLeaf,
  shareExploreConversation,
} from "#src/explore/store.ts";
import { scoutExploreSharesTotal } from "#src/metrics/explore.ts";
import {
  DareDraftEditorInputSchema,
  DareDraftPreviewInputSchema,
  previewDareDraftEditorV2,
  reviseDareDraftEditorV2,
  validateDareDraftEditorV2,
} from "#src/explore/dare-editor-v2.ts";
import {
  protectedProcedure,
  router,
  webMutationProcedure,
} from "#src/trpc/trpc.ts";

/**
 * Conversation management for explore.
 *
 * Starting and controlling a background answer uses tRPC; observers receive
 * snapshots and live events over SSE (see explore/http-route.ts). Conversation
 * management remains ordinary tRPC.
 * Every procedure re-checks the allowlist rather than trusting that the user
 * passed it when the conversation was created, so removing someone from an
 * allowlisted server takes their access away immediately.
 */

const conversationInput = z
  .object({ conversationId: ExploreConversationIdSchema })
  .strict();

/** Reads the caller's identity and confirms they may use explore at all. */
async function requireExploreUser(user: User): Promise<DiscordAccountId> {
  await assertExploreAccess(user);
  return DiscordAccountIdSchema.parse(user.discordId);
}

/**
 * The caller's id together with the servers they belong to.
 *
 * `assertExploreAccess` already fetches those servers to make its allowlist
 * decision, so returning them costs nothing extra — and starting a turn needs
 * them, because a `player('…')` alias may only resolve against servers the
 * asker is actually in.
 */
async function requireExploreUserAndGuilds(
  user: User,
): Promise<{ userId: DiscordAccountId; guildIds: string[] }> {
  const guildIds = await assertExploreAccess(user);
  return {
    userId: DiscordAccountIdSchema.parse(user.discordId),
    guildIds,
  };
}

const exploreProcedure = protectedProcedure;

export const exploreRouter = router({
  /**
   * Whether the caller may use explore, plus their remaining quota. Answers
   * `enabled: false` rather than throwing so the UI can render a "not
   * available" state instead of an error.
   */
  status: exploreProcedure.query(async ({ ctx }) => {
    if (!isExploreConfigured()) {
      return { enabled: false, quota: [] };
    }
    try {
      const userId = await requireExploreUser(ctx.user);
      return {
        enabled: true,
        quota: getExploreQuotaStatus({ userId }).quota,
      };
    } catch (error) {
      if (error instanceof TRPCError && error.code === "FORBIDDEN") {
        return { enabled: false, quota: [] };
      }
      throw error;
    }
  }),

  list: exploreProcedure.query(async ({ ctx }) => {
    const userId = await requireExploreUser(ctx.user);
    return await listExploreConversations(prisma, userId);
  }),

  dareList: exploreProcedure
    .input(
      z.strictObject({
        scope: z.enum(["mine", "guild"]),
        search: z.string().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
      const pages = await Promise.all(
        guildIds.map(
          async (guildId) =>
            await listVisibleDaresV2(
              {
                serverId: DiscordGuildIdSchema.parse(guildId),
                viewerDiscordId: userId,
                scope: input.scope,
                ...(input.search === undefined ? {} : { search: input.search }),
              },
              prisma,
            ),
        ),
      );
      return pages
        .flat()
        .toSorted((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        )
        .slice(0, 100);
    }),

  dareInspect: exploreProcedure
    .input(z.strictObject({ dareId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
      for (const guildId of guildIds) {
        const dare = await inspectVisibleDareV2(
          {
            dareId: input.dareId,
            serverId: DiscordGuildIdSchema.parse(guildId),
            viewerDiscordId: userId,
          },
          prisma,
        );
        if (dare !== null) return dare;
      }
      throw new TRPCError({ code: "NOT_FOUND", message: "Dare not found." });
    }),

  dareValidateDraft: exploreProcedure
    .input(DareDraftEditorInputSchema)
    .query(async ({ ctx, input }) => {
      const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
      return await validateDareDraftEditorV2(input, userId, guildIds);
    }),

  darePreviewDraft: exploreProcedure
    .input(DareDraftPreviewInputSchema)
    .query(async ({ ctx, input }) => {
      const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
      return await previewDareDraftEditorV2(input, userId, guildIds);
    }),

  dareReviseDraft: webMutationProcedure
    .input(DareDraftEditorInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
      return await reviseDareDraftEditorV2(input, userId, guildIds);
    }),

  confirmDareIntent: webMutationProcedure
    .input(z.strictObject({ intentId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
      const intent = await prisma.bucksDareV2ConfirmationIntent.findUnique({
        where: { id: input.intentId },
        include: { dare: { select: { serverId: true } } },
      });
      if (intent === null || !guildIds.includes(intent.dare.serverId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Confirmation not found.",
        });
      }
      const outcome = await consumeDareV2ConfirmationIntent({
        intentId: input.intentId,
        serverId: DiscordGuildIdSchema.parse(intent.dare.serverId),
        actorDiscordId: userId,
      });
      const callout = [
        "not_found",
        "forbidden",
        "intent_expired",
        "feature_disabled",
        "insufficient",
      ].includes(outcome.kind)
        ? null
        : await tryEnsureDareV2Callout(intent.dareId);
      return { ...outcome, callout };
    }),

  activeRuns: exploreProcedure.query(async ({ ctx }) => {
    const userId = await requireExploreUser(ctx.user);
    return await exploreRunManager.listDurable(userId);
  }),

  runOutcome: exploreProcedure
    .input(ExploreRunObserveRequestSchema)
    .query(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      return ExploreRunOutcomeResultSchema.parse({
        outcome: await exploreRunManager.durableOutcome(input.runId, userId),
      });
    }),

  start: webMutationProcedure
    .input(ExploreTurnRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
      try {
        return await exploreRunManager.start({ userId }, input, guildIds);
      } catch (error) {
        if (error instanceof ExploreConversationBusyError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        if (error instanceof ExploreRunRateLimitedError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: error.message,
          });
        }
        if (error instanceof ExploreRunUnavailableError) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: error.message,
          });
        }
        if (error instanceof ExploreNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        if (error instanceof ExploreInvalidTurnError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  stop: webMutationProcedure
    .input(z.object({ runId: ExploreRunIdSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      if (!(await exploreRunManager.stop(input.runId, userId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found." });
      }
      return { ok: true };
    }),

  get: exploreProcedure
    .input(conversationInput)
    .query(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      const transcript = await loadExploreTranscript(
        prisma,
        input.conversationId,
        userId,
      );
      if (transcript === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }
      return transcript;
    }),

  /**
   * Switch which version of a branched turn is being read.
   *
   * Takes the chosen message rather than a leaf: the store follows it down to
   * its own leaf, so picking an older question does not hide the answer that
   * came after it.
   */
  setLeaf: exploreProcedure
    .input(conversationInput.extend({ messageId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      const moved = await setExploreLeaf(
        prisma,
        input.conversationId,
        userId,
        input.messageId,
      );
      if (!moved) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }
      return { ok: true };
    }),

  rename: exploreProcedure
    .input(
      conversationInput.extend({
        title: ExploreConversationTitleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      const renamed = await renameExploreConversation(
        prisma,
        input.conversationId,
        userId,
        input.title,
      );
      if (!renamed) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }
      return { ok: true };
    }),

  delete: exploreProcedure
    .input(conversationInput)
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      let deleted: boolean;
      try {
        deleted = await exploreRunManager.deleteConversationAndWait(
          input.conversationId,
          userId,
        );
      } catch (error) {
        if (error instanceof ExploreConversationBusyError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }
      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }
      return { ok: true };
    }),

  share: exploreProcedure
    .input(conversationInput)
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      const shareToken = await shareExploreConversation(
        prisma,
        input.conversationId,
        userId,
      );
      if (shareToken === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }
      scoutExploreSharesTotal.inc({ action: "share" });
      return { shareToken };
    }),

  revokeShare: exploreProcedure
    .input(conversationInput)
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      const revoked = await revokeExploreShare(
        prisma,
        input.conversationId,
        userId,
      );
      if (!revoked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }
      scoutExploreSharesTotal.inc({ action: "revoke" });
      return { ok: true };
    }),
});
