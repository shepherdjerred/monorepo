import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { User } from "#generated/prisma/client/index.js";
import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
  EXPLORE_TITLE_MAX_LENGTH,
  ExploreConversationIdSchema,
  ExploreRunIdSchema,
  ExploreTurnRequestSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  assertExploreAccess,
  isExploreConfigured,
} from "#src/explore/access.ts";
import { getExploreQuotaStatus } from "#src/explore/rate-limit.ts";
import {
  ExploreConversationBusyError,
  ExploreRunRateLimitedError,
  ExploreRunUnavailableError,
  exploreRunManager,
} from "#src/explore/run-manager.ts";
import {
  ExploreInvalidTurnError,
  ExploreNotFoundError,
  deleteExploreConversation,
  listExploreConversations,
  loadExploreTranscript,
  renameExploreConversation,
  revokeExploreShare,
  setExploreLeaf,
  shareExploreConversation,
} from "#src/explore/store.ts";
import { scoutExploreSharesTotal } from "#src/metrics/explore.ts";
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

  activeRuns: exploreProcedure.query(async ({ ctx }) => {
    const userId = await requireExploreUser(ctx.user);
    return exploreRunManager.list(userId);
  }),

  start: webMutationProcedure
    .input(ExploreTurnRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = await requireExploreUser(ctx.user);
      try {
        return await exploreRunManager.start({ userId }, input);
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
      if (!exploreRunManager.stop(input.runId, userId)) {
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
        title: z.string().trim().min(1).max(EXPLORE_TITLE_MAX_LENGTH),
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
      await exploreRunManager.stopConversationAndWait(
        input.conversationId,
        userId,
      );
      const deleted = await deleteExploreConversation(
        prisma,
        input.conversationId,
        userId,
      );
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
