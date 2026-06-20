/**
 * Web-UI competition management. Exposes the competition surface that was
 * previously Discord-command-only (create/edit/cancel/participants/schedule)
 * plus cached leaderboard reads and an explicit "refresh standings" recompute.
 *
 * Every procedure is gated on per-guild Administrator via `assertGuildAdmin`.
 * Admins are exactly the bypass branch of the Discord-side permission checks,
 * so the `PermissionsBitField`-based `canCreateCompetition` is intentionally
 * not used here. Any fetch-by-id additionally verifies the row belongs to the
 * requested guild (NOT_FOUND otherwise) to prevent cross-guild ID probing.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  CompetitionCriteriaSchema,
  CompetitionIdSchema,
  CompetitionVisibilitySchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
  SeasonIdSchema,
  getCompetitionStatus,
  type CompetitionId,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import { CompetitionCronSchema } from "@scout-for-lol/data/model/competition-cron.ts";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competition-cron.ts";
import { CompetitionDatesSchema } from "#src/database/competition/validation.ts";
import { router, webProcedure, webMutationProcedure } from "#src/trpc/trpc.ts";
import {
  assertChannelInGuild,
  assertGuildAdmin,
} from "#src/trpc/guild-guard.ts";
import { prisma } from "#src/database/index.ts";
import {
  cancelCompetition,
  createCompetition,
  getCompetitionById,
  getCompetitionsByServerPaginated,
  updateCompetition,
  type UpdateCompetitionInput,
} from "#src/database/competition/queries.ts";
import {
  addParticipant,
  removeParticipant,
} from "#src/database/competition/participants.ts";
import {
  validateOwnerLimit,
  validateServerLimit,
} from "#src/database/competition/validation.ts";
import {
  loadCachedLeaderboard,
  loadHistoricalLeaderboardSnapshots,
} from "#src/storage/s3-leaderboard.ts";
import { refreshAndCacheLeaderboard } from "#src/league/competition/refresh.ts";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const CompetitionIdInput = GuildInput.extend({
  competitionId: CompetitionIdSchema,
});

/**
 * Web date input. The tRPC link carries no superjson transformer, so `Date`s
 * arrive as ISO strings — coerce them, then the existing duration/ordering
 * rules apply via `CompetitionDatesSchema.parse` in the handler.
 */
const WebCompetitionDatesSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("FIXED_DATES"),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  }),
  z.object({ type: z.literal("SEASON"), seasonId: SeasonIdSchema }),
]);

const CompetitionWriteSchema = z.object({
  channelId: DiscordChannelIdSchema,
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  visibility: CompetitionVisibilitySchema,
  maxParticipants: z.number().int().min(2).max(100).default(50),
  dates: WebCompetitionDatesSchema,
  criteria: CompetitionCriteriaSchema,
  updateCronExpression: CompetitionCronSchema.nullable().default(null),
});

/** Translate a domain `Error` (thrown by participant/competition mutations) into a user-facing 400. */
function asBadRequest(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

async function loadCompetitionOr404(
  competitionId: CompetitionId,
  guildId: string,
): Promise<CompetitionWithCriteria> {
  const competition = await getCompetitionById(prisma, competitionId);
  if (competition?.serverId !== guildId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Competition not found",
    });
  }
  return competition;
}

export const competitionRouter = router({
  list: webProcedure
    .input(
      GuildInput.extend({
        activeOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.number().int().min(1).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const { items, nextCursor } = await getCompetitionsByServerPaginated(
        prisma,
        input.guildId,
        {
          activeOnly: input.activeOnly,
          limit: input.limit,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        },
      );
      const participantCounts = await prisma.competitionParticipant.groupBy({
        by: ["competitionId"],
        where: {
          competitionId: { in: items.map((c) => c.id) },
          status: { not: "LEFT" },
        },
        _count: { _all: true },
      });
      const countByCompetition = new Map(
        participantCounts.map((row) => [row.competitionId, row._count._all]),
      );
      return {
        items: items.map((competition) => ({
          ...competition,
          status: getCompetitionStatus(competition),
          participantCount: countByCompetition.get(competition.id) ?? 0,
        })),
        nextCursor,
      };
    }),

  get: webProcedure.input(CompetitionIdInput).query(async ({ ctx, input }) => {
    await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
    const competition = await loadCompetitionOr404(
      input.competitionId,
      input.guildId,
    );
    const participants = await prisma.competitionParticipant.findMany({
      where: { competitionId: input.competitionId },
      include: {
        player: { select: { id: true, alias: true, discordId: true } },
      },
      orderBy: { joinedAt: "asc" },
    });
    return {
      ...competition,
      status: getCompetitionStatus(competition),
      participants: participants.map((participant) => ({
        id: participant.id,
        playerId: participant.playerId,
        alias: participant.player.alias,
        discordId: participant.player.discordId,
        status: participant.status,
        invitedBy: participant.invitedBy,
        invitedAt: participant.invitedAt,
        joinedAt: participant.joinedAt,
        leftAt: participant.leftAt,
      })),
    };
  }),

  create: webMutationProcedure
    .input(GuildInput.extend(CompetitionWriteSchema.shape))
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.channelId,
      });
      const ownerId = DiscordAccountIdSchema.parse(ctx.user.discordId);
      const dates = CompetitionDatesSchema.parse(input.dates);

      // Persistent active-competition limits (per server + per owner). The
      // single-instance in-memory rate limiter is intentionally skipped: it
      // guards the Discord non-admin grant flow, and the web app is admin-only.
      try {
        await validateServerLimit(prisma, input.guildId, ownerId);
        await validateOwnerLimit(prisma, input.guildId, ownerId);
      } catch (error) {
        asBadRequest(error);
      }

      return createCompetition(prisma, {
        serverId: input.guildId,
        ownerId,
        channelId: input.channelId,
        title: input.title,
        description: input.description,
        visibility: input.visibility,
        maxParticipants: input.maxParticipants,
        dates,
        criteria: input.criteria,
        updateCronExpression: input.updateCronExpression,
      });
    }),

  edit: webMutationProcedure
    .input(
      CompetitionIdInput.extend({
        channelId: DiscordChannelIdSchema.optional(),
        title: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().min(1).max(500).optional(),
        visibility: CompetitionVisibilitySchema.optional(),
        maxParticipants: z.number().int().min(2).max(100).optional(),
        dates: WebCompetitionDatesSchema.optional(),
        criteria: CompetitionCriteriaSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const competition = await loadCompetitionOr404(
        input.competitionId,
        input.guildId,
      );
      const status = getCompetitionStatus(competition);
      if (status === "CANCELLED" || status === "ENDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${status} competition cannot be edited.`,
        });
      }

      const changesCriteriaOrDates =
        input.criteria !== undefined || input.dates !== undefined;
      if (status === "ACTIVE" && changesCriteriaOrDates) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Criteria and dates are locked once a competition is active — they would invalidate snapshots and the lifecycle schedule.",
        });
      }
      if (
        status === "ACTIVE" &&
        input.maxParticipants !== undefined &&
        input.maxParticipants < competition.maxParticipants
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Participant cap can only be increased while a competition is active.",
        });
      }

      if (input.channelId !== undefined) {
        assertChannelInGuild({
          guildId: input.guildId,
          channelId: input.channelId,
        });
      }

      // exactOptionalPropertyTypes: only set keys that were actually provided.
      const updateInput: UpdateCompetitionInput = {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.channelId === undefined
          ? {}
          : { channelId: input.channelId }),
        ...(input.visibility === undefined
          ? {}
          : { visibility: input.visibility }),
        ...(input.maxParticipants === undefined
          ? {}
          : { maxParticipants: input.maxParticipants }),
        ...(input.dates === undefined
          ? {}
          : { dates: CompetitionDatesSchema.parse(input.dates) }),
        ...(input.criteria === undefined ? {} : { criteria: input.criteria }),
      };
      try {
        return await updateCompetition(
          prisma,
          input.competitionId,
          updateInput,
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  cancel: webMutationProcedure
    .input(CompetitionIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const competition = await loadCompetitionOr404(
        input.competitionId,
        input.guildId,
      );
      const status = getCompetitionStatus(competition);
      if (status === "CANCELLED" || status === "ENDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Competition is already ${status}.`,
        });
      }
      return cancelCompetition(prisma, input.competitionId);
    }),

  invite: webMutationProcedure
    .input(
      CompetitionIdInput.extend({
        playerId: PlayerIdSchema.optional(),
        discordUserId: DiscordAccountIdSchema.optional(),
      }).refine(
        (value) =>
          (value.playerId === undefined) !==
          (value.discordUserId === undefined),
        { message: "Provide exactly one of playerId or discordUserId" },
      ),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      await loadCompetitionOr404(input.competitionId, input.guildId);

      // The .refine guarantees exactly one of playerId/discordUserId is set;
      // resolve to a player scoped to this guild (early returns keep Prisma's
      // where types free of a `| undefined`).
      const player = await (async () => {
        if (input.playerId !== undefined) {
          return prisma.player.findFirst({
            where: { id: input.playerId, serverId: input.guildId },
          });
        }
        if (input.discordUserId !== undefined) {
          return prisma.player.findFirst({
            where: {
              serverId: input.guildId,
              discordId: input.discordUserId,
            },
          });
        }
        return null;
      })();
      if (player === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No player with a linked League account found for that user in this server.",
        });
      }

      try {
        return await addParticipant({
          prisma,
          competitionId: input.competitionId,
          playerId: PlayerIdSchema.parse(player.id),
          status: "INVITED",
          invitedBy: DiscordAccountIdSchema.parse(ctx.user.discordId),
        });
      } catch (error) {
        asBadRequest(error);
      }
    }),

  removeParticipant: webMutationProcedure
    .input(CompetitionIdInput.extend({ playerId: PlayerIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      await loadCompetitionOr404(input.competitionId, input.guildId);
      try {
        return await removeParticipant(
          prisma,
          input.competitionId,
          input.playerId,
        );
      } catch (error) {
        asBadRequest(error);
      }
    }),

  addAllMembers: webMutationProcedure
    .input(CompetitionIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      await loadCompetitionOr404(input.competitionId, input.guildId);
      const players = await prisma.player.findMany({
        where: { serverId: input.guildId },
      });
      const results = await Promise.allSettled(
        players.map((player) =>
          addParticipant({
            prisma,
            competitionId: input.competitionId,
            playerId: PlayerIdSchema.parse(player.id),
            status: "JOINED",
          }),
        ),
      );
      const added = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      return { added, failed: results.length - added };
    }),

  updateSchedule: webMutationProcedure
    .input(
      CompetitionIdInput.extend({
        updateCronExpression: CompetitionCronSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const competition = await loadCompetitionOr404(
        input.competitionId,
        input.guildId,
      );
      const status = getCompetitionStatus(competition);
      if (status === "CANCELLED" || status === "ENDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot reschedule a ${status} competition.`,
        });
      }
      const now = new Date();
      return prisma.competition.update({
        where: { id: input.competitionId },
        data: {
          updateCronExpression: input.updateCronExpression,
          // Only arm the next fire once the competition has been activated;
          // otherwise the lifecycle task computes it on start.
          nextScheduledUpdateAt:
            competition.startProcessedAt === null
              ? null
              : computeNextScheduledUpdateAt(input.updateCronExpression, now),
          updatedTime: now,
        },
      });
    }),

  leaderboard: webProcedure
    .input(CompetitionIdInput)
    .query(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      await loadCompetitionOr404(input.competitionId, input.guildId);
      return loadCachedLeaderboard(input.competitionId);
    }),

  leaderboardHistory: webProcedure
    .input(CompetitionIdInput)
    .query(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      await loadCompetitionOr404(input.competitionId, input.guildId);
      return loadHistoricalLeaderboardSnapshots(input.competitionId);
    }),

  refreshLeaderboard: webMutationProcedure
    .input(CompetitionIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const competition = await loadCompetitionOr404(
        input.competitionId,
        input.guildId,
      );
      try {
        const entries = await refreshAndCacheLeaderboard(competition);
        return { entries };
      } catch (error) {
        asBadRequest(error);
      }
    }),
});
