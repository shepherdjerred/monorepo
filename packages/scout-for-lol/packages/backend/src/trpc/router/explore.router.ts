import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { User } from "#generated/prisma/client/index.js";
import {
  ConfirmationIntentKindSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  ExploreConversationIdSchema,
  ExploreConversationTitleSchema,
  ExploreRunIdSchema,
  ExploreRunObserveRequestSchema,
  ExploreRunOutcomeResultSchema,
  ExploreTurnRequestSchema,
  ExploreMentionCandidateSchema,
  ExploreMentionSearchSchema,
} from "@scout-for-lol/data";
import { consumeDareV2ConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent-consume-v2.ts";
import { tryEnsureDareV2Callout } from "#src/betting/dares/presentation/dare-callout-v2.ts";
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
import { resolvePlayerIdentities } from "#src/reports/identity.ts";
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

/**
 * Loads a confirmation intent the caller's servers can see.
 *
 * The guild is stored on the intent, so this is a direct column comparison
 * rather than a join through the dare it targets. Probing an intent in another
 * server has to stay indistinguishable from it not existing, hence NOT_FOUND
 * for both.
 */
async function requireGuildIntent(intentId: string, guildIds: string[]) {
  const intent = await prisma.confirmationIntent.findUnique({
    where: { id: intentId },
  });
  if (!guildIds.includes(intent?.serverId ?? "")) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Confirmation not found.",
    });
  }
  if (intent === null) {
    throw new Error("A visible confirmation unexpectedly disappeared.");
  }
  return intent;
}

const exploreProcedure = protectedProcedure;

/**
 * The status of one confirmation intent the caller owns.
 *
 * Registered under two names. `dareIntentStatus` is what this procedure was
 * called before confirmation intents stopped being dare-only, and a tab loaded
 * before that deployment keeps polling the old name for a confirmation card it
 * is still showing. The intent migration deliberately preserved those ids so
 * the cards keep working, and dropping the procedure they poll would have
 * undone exactly that. Remove the alias one release after deploy, once stale
 * clients have aged out.
 */
const intentStatusProcedure = exploreProcedure
  .input(z.strictObject({ intentId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
    const intent = await requireGuildIntent(input.intentId, guildIds);
    if (intent.actorDiscordId !== userId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Confirmation not found.",
      });
    }
    return {
      state:
        intent.consumedAt === null
          ? intent.expiresAt.getTime() <= Date.now()
            ? ("expired" as const)
            : ("pending" as const)
          : ("consumed" as const),
      kind: ConfirmationIntentKindSchema.parse(intent.kind),
      expiresAt: intent.expiresAt.toISOString(),
      result:
        intent.resultJson === null
          ? null
          : z.json().parse(JSON.parse(intent.resultJson)),
    };
  });

/**
 * Enough to choose from, few enough that a lake scan stays cheap and the
 * popover does not become a second scroll region.
 */
const MENTION_RESULT_LIMIT = 8;

export const exploreRouter = router({
  /**
   * Whether the caller may use explore, plus their remaining quota. Answers
   * `enabled: false` rather than throwing so the UI can render a "not
   * available" state instead of an error.
   */
  /**
   * Players the composer's `@` picker may offer.
   *
   * Scoped exactly like starting a turn — `requireExploreUserAndGuilds` —
   * because it answers the same question a `player('…')` alias does, and a
   * looser scope here would let someone enumerate aliases from servers they
   * are not in. `consumerPlayer.search` is deliberately not reused: it scopes
   * through `assertConsumerPlayerScope`, a different authorization rule.
   *
   * This reads the DuckDB lake, not Postgres, so it is heavier than a typical
   * typeahead. The client debounces and this caps the result set; neither is
   * decoration.
   */
  searchPlayers: exploreProcedure
    .input(ExploreMentionSearchSchema)
    .query(async ({ ctx, input }) => {
      const { guildIds } = await requireExploreUserAndGuilds(ctx.user);
      const identities = await resolvePlayerIdentities({
        query: input.query,
        guildIds,
        // A typeahead has to answer before the reader has finished typing.
        // `player('…')` resolution keeps the default exact rule, where a
        // widened match would turn "one person" into "ambiguous".
        match: "prefix",
      });
      return identities.slice(0, MENTION_RESULT_LIMIT).map((identity) =>
        ExploreMentionCandidateSchema.parse({
          kind: "player",
          label: identity.displayName,
          // The most recent Riot ID when there is one: it is the form that
          // resolves to exactly one person, and `resolvePlayerRefPuuids`
          // throws rather than guessing when a name is ambiguous.
          insertText: identity.riotIds[0] ?? identity.displayName,
          detail: `${identity.games.toLocaleString("en-US")} games`,
        }),
      );
    }),

  status: exploreProcedure.query(async ({ ctx }) => {
    if (!isExploreConfigured()) {
      return { enabled: false, quota: [] };
    }
    try {
      const { userId } = await requireExploreUserAndGuilds(ctx.user);
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

  intentStatus: intentStatusProcedure,

  /** @deprecated Pre-rename alias; see {@link intentStatusProcedure}. */
  dareIntentStatus: intentStatusProcedure,

  confirmDareIntent: webMutationProcedure
    .input(z.strictObject({ intentId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, guildIds } = await requireExploreUserAndGuilds(ctx.user);
      const intent = await requireGuildIntent(input.intentId, guildIds);
      if (intent.dareId === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Confirmation not found.",
        });
      }
      const outcome = await consumeDareV2ConfirmationIntent({
        intentId: input.intentId,
        serverId: DiscordGuildIdSchema.parse(intent.serverId),
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
