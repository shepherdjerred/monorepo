import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { User } from "#generated/prisma/client/index.js";
import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
  EXPLORE_TITLE_MAX_LENGTH,
  ExploreConversationIdSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  assertExploreAccess,
  isExploreConfigured,
} from "#src/explore/access.ts";
import { getExploreQuotaStatus } from "#src/explore/rate-limit.ts";
import {
  deleteExploreConversation,
  listExploreConversations,
  loadExploreTranscript,
  renameExploreConversation,
  revokeExploreShare,
  shareExploreConversation,
} from "#src/explore/store.ts";
import { scoutExploreSharesTotal } from "#src/metrics/explore.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

/**
 * Conversation management for explore.
 *
 * Asking a question streams over SSE (see explore/http-route.ts); everything
 * else — listing, reading, renaming, deleting, sharing — is ordinary tRPC.
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
