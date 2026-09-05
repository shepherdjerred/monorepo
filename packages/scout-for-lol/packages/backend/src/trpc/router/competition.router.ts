/**
 * Web-UI competition management. Exposes the competition surface that was
 * previously Discord-command-only (create/edit/cancel/participants/schedule)
 * plus cached leaderboard reads and an explicit "refresh standings" recompute.
 *
 * Every procedure is gated on a `competitions:<action>` permission via
 * `guildProcedure`/`guildMutationProcedure` (Discord admins/owners hold all
 * permissions). Any fetch-by-id additionally verifies the row belongs to the
 * requested guild (NOT_FOUND otherwise) to prevent cross-guild ID probing.
 *
 * `create` is a thin caller: the pipeline — including the `competitions:invite`
 * and `competitions:schedule` sub-gates and root's rate-limit bypass — lives in
 * `#src/lib/competitions/create.ts` so other surfaces run the same policy, and
 * it commits with its `COMPETITION_CREATE` audit row in one transaction.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  CompetitionIdSchema,
  CompetitionWriteSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
  CompetitionStatusSchema,
  getCompetitionStatus,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import { validateCompetitionConfiguration } from "#src/database/competition/configuration-validation.ts";
import {
  CompetitionEditInputSchema,
  assertCompetitionEditable,
  buildCompetitionUpdateInput,
} from "#src/trpc/router/competition-edit-input.ts";
import { router } from "#src/trpc/trpc.ts";
import { assertChannelInGuild } from "#src/trpc/guild-guard.ts";
import {
  guildProcedure,
  guildMutationProcedure,
} from "#src/trpc/guild-permission.ts";
import { prisma } from "#src/database/index.ts";
import {
  cancelCompetition,
  getCompetitionsByServerPaginated,
  updateCompetition,
} from "#src/database/competition/queries.ts";
import {
  addParticipant,
  bulkEnrollTrackedPlayers,
  InitialEntrantsValidationError,
  removeParticipant,
} from "#src/database/competition/participants.ts";
import { runAuditedMutation } from "#src/lib/audit/audited-mutation.ts";
import {
  createCompetitionForActor,
  recordCompetitionCreation,
  type CreateCompetitionResult,
} from "#src/lib/competitions/create.ts";
import { competitionAnalysisProcedures } from "#src/trpc/router/competition-analysis-procedures.ts";
import { competitionDeliveryProcedures } from "#src/trpc/router/competition-delivery-procedures.ts";
import {
  asCompetitionBadRequest,
  loadGuildCompetitionOr404,
} from "#src/trpc/router/competition-router-helpers.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const CompetitionIdInput = GuildInput.extend({
  competitionId: CompetitionIdSchema,
});

export const competitionRouter = router({
  builderCapabilities: guildProcedure("competitions", "create")
    .input(GuildInput)
    .query(async ({ ctx, input }) => ({
      builderV2Enabled: await isPolicyEnabled(
        "competition_builder_v2_enabled",
        {
          server: input.guildId,
          user: ctx.user.discordId,
        },
      ),
    })),

  list: guildProcedure("competitions", "read")
    .input(
      GuildInput.extend({
        activeOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.number().int().min(1).optional(),
      }),
    )
    .query(async ({ input }) => {
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
          status: CompetitionStatusSchema.parse(
            getCompetitionStatus(competition),
          ),
          participantCount: countByCompetition.get(competition.id) ?? 0,
        })),
        nextCursor,
      };
    }),

  get: guildProcedure("competitions", "read")
    .input(CompetitionIdInput)
    .query(async ({ input }) => {
      const competition = await loadGuildCompetitionOr404(
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
        status: CompetitionStatusSchema.parse(
          getCompetitionStatus(competition),
        ),
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

  create: guildMutationProcedure("competitions", "create")
    .input(GuildInput.extend(CompetitionWriteSchema.shape))
    .mutation(async ({ ctx, input }) => {
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.channelId,
      });
      const ownerId = DiscordAccountIdSchema.parse(ctx.user.discordId);

      // Creation, SERVER_WIDE enrollment and the audit row run in one
      // transaction so an enrollment failure rolls the new competition back
      // rather than leaving a partial/orphaned row the client would retry into
      // a duplicate.
      let result: CreateCompetitionResult;
      try {
        result = await runAuditedMutation(
          ctx,
          input.guildId,
          (tx) =>
            createCompetitionForActor({
              db: tx,
              permissions: ctx.permissions,
              guildId: input.guildId,
              ownerId,
              input,
            }),
          (created) =>
            created.kind === "created"
              ? {
                  action: "COMPETITION_CREATE",
                  targetChannelId: input.channelId,
                  payload: {
                    competitionId: created.competition.id,
                    title: input.title,
                    visibility: input.visibility,
                    gameVariant: input.gameVariant,
                    maxParticipants: input.maxParticipants,
                    initialPlayerIds: input.initialPlayerIds,
                  },
                }
              : null,
        );
      } catch (error) {
        if (error instanceof InitialEntrantsValidationError) {
          asCompetitionBadRequest(error);
        }
        throw error;
      }
      if (result.kind === "missing_permission") {
        throw new TRPCError({ code: "FORBIDDEN", message: result.message });
      }
      if (result.kind !== "created") {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }
      recordCompetitionCreation({
        permissions: ctx.permissions,
        guildId: input.guildId,
        ownerId,
      });
      return result.competition;
    }),

  edit: guildMutationProcedure("competitions", "update")
    .input(CompetitionEditInputSchema)
    .mutation(async ({ ctx, input }) => {
      const competition = await loadGuildCompetitionOr404(
        input.competitionId,
        input.guildId,
      );
      assertCompetitionEditable(competition, input);

      // Refill server-wide entrants when visibility changes or the cap rises.
      const enrollsServerWide =
        (input.visibility ?? competition.visibility) === "SERVER_WIDE" &&
        (competition.visibility !== "SERVER_WIDE" ||
          (input.maxParticipants !== undefined &&
            input.maxParticipants > competition.maxParticipants));
      if (enrollsServerWide && !ctx.permissions.can("competitions", "invite")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Server-wide competitions enroll every tracked player, which requires the invite permission.",
        });
      }

      if (input.channelId !== undefined) {
        assertChannelInGuild({
          guildId: input.guildId,
          channelId: input.channelId,
        });
      }

      try {
        validateCompetitionConfiguration(
          input.criteria ?? competition.criteria,
          input.gameVariant ?? competition.gameVariant,
        );
      } catch (error) {
        asCompetitionBadRequest(error);
      }

      const updateInput = buildCompetitionUpdateInput(input);
      // Keep the update and any server-wide enrollment atomic.
      let updated: CompetitionWithCriteria;
      try {
        updated = await prisma.$transaction(async (tx) => {
          const result = await updateCompetition(
            tx,
            input.competitionId,
            updateInput,
          );
          if (enrollsServerWide) {
            await bulkEnrollTrackedPlayers({
              prisma: tx,
              competitionId: input.competitionId,
              guildId: input.guildId,
            });
          }
          return result;
        });
      } catch (error) {
        asCompetitionBadRequest(error);
      }
      return updated;
    }),

  cancel: guildMutationProcedure("competitions", "cancel")
    .input(CompetitionIdInput)
    .mutation(async ({ input }) => {
      const competition = await loadGuildCompetitionOr404(
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

  invite: guildMutationProcedure("competitions", "invite")
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
      await loadGuildCompetitionOr404(input.competitionId, input.guildId);

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
        asCompetitionBadRequest(error);
      }
    }),

  removeParticipant: guildMutationProcedure("competitions", "invite")
    .input(CompetitionIdInput.extend({ playerId: PlayerIdSchema }))
    .mutation(async ({ input }) => {
      await loadGuildCompetitionOr404(input.competitionId, input.guildId);
      try {
        return await removeParticipant(
          prisma,
          input.competitionId,
          input.playerId,
        );
      } catch (error) {
        asCompetitionBadRequest(error);
      }
    }),

  addAllMembers: guildMutationProcedure("competitions", "invite")
    .input(CompetitionIdInput)
    .mutation(async ({ input }) => {
      await loadGuildCompetitionOr404(input.competitionId, input.guildId);
      // One transaction (like create/edit) so a mid-batch failure rolls back.
      return prisma.$transaction((tx) =>
        bulkEnrollTrackedPlayers({
          prisma: tx,
          competitionId: input.competitionId,
          guildId: input.guildId,
        }),
      );
    }),

  ...competitionAnalysisProcedures,
  ...competitionDeliveryProcedures,
});
