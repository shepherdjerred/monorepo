import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { assertDuelsEnabled } from "#src/progression/duels/access.ts";
import { advanceDuelEvent } from "#src/progression/duels/advancement.ts";
import {
  eligibleDuelAccounts,
  linkedDuelAccounts,
} from "#src/progression/duels/competitors.ts";
import {
  createDuelEvent,
  startDuelEvent,
} from "#src/progression/duels/events.ts";
import {
  acceptDuelEventRegistration,
  registerDuelEventEntrant,
} from "#src/progression/duels/registration.ts";
import {
  launchDuelSeries,
  signalDuelSeries,
} from "#src/progression/duels/launch.ts";
import {
  getDuelEvent,
  getDuelEventStandings,
  getDuelHeadToHead,
  getRollingDuelRecords,
  listGuildDuels,
} from "#src/progression/duels/read.ts";
import { decideDuelSeries } from "#src/progression/duels/review.ts";
import {
  acceptDuelChallenge,
  acceptDuelDisclosure,
  createDirectDuel,
  getDuelCode,
  getDuelSeries,
  markDuelReady,
} from "#src/progression/duels/series.ts";
import {
  guildMutationProcedure,
  guildProcedure,
  resolveGuildPermissions,
} from "#src/trpc/guild-permission.ts";
import { assertChannelInGuild } from "#src/trpc/guild-guard.ts";
import { router, webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";
import {
  DirectDuelChallengeInputSchema,
  DuelCompetitorSelectionInputSchema,
  DuelEventInputSchema,
  DuelGuildInputSchema,
  duelCompetitorSelection,
} from "#src/trpc/router/duel-router-contracts.ts";

function viewerId(value: string) {
  return DiscordAccountIdSchema.parse(value);
}

function domainError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : "Duel request failed",
    cause: error,
  });
}

async function assertMemberAndFeature(
  user: Parameters<typeof resolveGuildPermissions>[0],
  guildId: ReturnType<typeof DiscordGuildIdSchema.parse>,
) {
  await resolveGuildPermissions(user, guildId);
  await assertDuelsEnabled(prisma, guildId, configuration.environment);
}

export const duelRouter = router({
  list: webProcedure
    .input(DuelGuildInputSchema)
    .query(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      return await listGuildDuels(
        prisma,
        input.guildId,
        viewerId(ctx.user.discordId),
      );
    }),
  linkedAccounts: webProcedure
    .input(DuelGuildInputSchema)
    .query(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      return await linkedDuelAccounts(
        prisma,
        input.guildId,
        viewerId(ctx.user.discordId),
      );
    }),
  eligibleAccounts: webProcedure
    .input(DuelGuildInputSchema)
    .query(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      return await eligibleDuelAccounts(prisma, input.guildId);
    }),
  challenge: webMutationProcedure
    .input(DirectDuelChallengeInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.channelId,
      });
      try {
        const request = await createDirectDuel(prisma, {
          ...input,
          first: duelCompetitorSelection(input.first),
          second: duelCompetitorSelection(input.second),
          organizerDiscordId: viewerId(ctx.user.discordId),
          stage: configuration.environment,
        });
        await launchDuelSeries({
          stage: configuration.environment,
          ...request,
        });
        return request;
      } catch (error) {
        return domainError(error);
      }
    }),
  acceptDisclosure: webMutationProcedure
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        playerId: PlayerIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      try {
        return await acceptDuelDisclosure(prisma, {
          ...input,
          discordId: viewerId(ctx.user.discordId),
        });
      } catch (error) {
        return domainError(error);
      }
    }),
  acceptChallenge: webMutationProcedure
    .input(
      z.strictObject({ guildId: DiscordGuildIdSchema, seriesId: z.uuid() }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      try {
        const result = await acceptDuelChallenge(
          prisma,
          input.seriesId,
          viewerId(ctx.user.discordId),
          input.guildId,
        );
        await signalDuelSeries({
          stage: configuration.environment,
          seriesId: input.seriesId,
          deadlineAt: result.deadlineAt,
          requestId: `accept:${crypto.randomUUID()}`,
        });
        return { accepted: true };
      } catch (error) {
        return domainError(error);
      }
    }),
  ready: webMutationProcedure
    .input(
      z.strictObject({ guildId: DiscordGuildIdSchema, seriesId: z.uuid() }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      try {
        const result = await markDuelReady(
          prisma,
          input.seriesId,
          viewerId(ctx.user.discordId),
          input.guildId,
        );
        await signalDuelSeries({
          stage: configuration.environment,
          seriesId: input.seriesId,
          deadlineAt: result.deadlineAt,
          requestId: `ready:${crypto.randomUUID()}`,
        });
        return { ready: true };
      } catch (error) {
        return domainError(error);
      }
    }),
  series: webProcedure
    .input(
      z.strictObject({ guildId: DiscordGuildIdSchema, seriesId: z.uuid() }),
    )
    .query(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      try {
        return await getDuelSeries(
          prisma,
          input.seriesId,
          viewerId(ctx.user.discordId),
          input.guildId,
        );
      } catch (error) {
        return domainError(error);
      }
    }),
  code: webProcedure
    .input(
      z.strictObject({ guildId: DiscordGuildIdSchema, seriesId: z.uuid() }),
    )
    .query(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      try {
        return await getDuelCode(
          prisma,
          input.seriesId,
          viewerId(ctx.user.discordId),
          input.guildId,
        );
      } catch (error) {
        return domainError(error);
      }
    }),
  createEvent: guildMutationProcedure("competitions", "create")
    .input(DuelEventInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertDuelsEnabled(
        prisma,
        input.guildId,
        configuration.environment,
      );
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.channelId,
      });
      try {
        return await createDuelEvent(prisma, {
          guildId: input.guildId,
          channelId: input.channelId,
          name: input.name,
          format: input.format,
          competitorKind: input.competitorKind,
          bestOf: input.bestOf,
          ruleset: input.ruleset,
          registrationMode: input.registrationMode,
          seedMethod: input.seedMethod,
          matchWindowHours: input.matchWindowHours,
          roundOverrides: input.roundOverrides,
          organizerDiscordId: viewerId(ctx.user.discordId),
          ...(input.registrationClosesAt === undefined
            ? {}
            : { registrationClosesAt: input.registrationClosesAt }),
        });
      } catch (error) {
        return domainError(error);
      }
    }),
  register: webMutationProcedure
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        eventId: z.uuid(),
        selection: DuelCompetitorSelectionInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      try {
        return await registerDuelEventEntrant(prisma, {
          guildId: input.guildId,
          eventId: input.eventId,
          actorDiscordId: viewerId(ctx.user.discordId),
          selection: duelCompetitorSelection(input.selection),
          source: "open",
        });
      } catch (error) {
        return domainError(error);
      }
    }),
  invite: guildMutationProcedure("competitions", "invite")
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        eventId: z.uuid(),
        selection: DuelCompetitorSelectionInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDuelsEnabled(
        prisma,
        input.guildId,
        configuration.environment,
      );
      try {
        return await registerDuelEventEntrant(prisma, {
          guildId: input.guildId,
          eventId: input.eventId,
          actorDiscordId: viewerId(ctx.user.discordId),
          selection: duelCompetitorSelection(input.selection),
          source: "invitation",
        });
      } catch (error) {
        return domainError(error);
      }
    }),
  acceptRegistration: webMutationProcedure
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        eventId: z.uuid(),
        competitorId: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      try {
        await acceptDuelEventRegistration(prisma, {
          guildId: input.guildId,
          eventId: input.eventId,
          competitorId: input.competitorId,
          actorDiscordId: viewerId(ctx.user.discordId),
        });
        return { accepted: true };
      } catch (error) {
        return domainError(error);
      }
    }),
  startEvent: guildMutationProcedure("competitions", "update")
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        eventId: z.uuid(),
        manualOrder: z.uuid().array().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDuelsEnabled(
        prisma,
        input.guildId,
        configuration.environment,
      );
      try {
        const requests = await startDuelEvent(prisma, {
          guildId: input.guildId,
          eventId: input.eventId,
          actorDiscordId: viewerId(ctx.user.discordId),
          stage: configuration.environment,
          ...(input.manualOrder === undefined
            ? {}
            : { manualOrder: input.manualOrder }),
        });
        await Promise.all(
          requests.map((request) =>
            launchDuelSeries({
              stage: configuration.environment,
              ...request,
            }),
          ),
        );
        return requests;
      } catch (error) {
        return domainError(error);
      }
    }),
  event: webProcedure
    .input(z.strictObject({ guildId: DiscordGuildIdSchema, eventId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await assertMemberAndFeature(ctx.user, input.guildId);
      return await getDuelEvent(
        prisma,
        input.guildId,
        input.eventId,
        viewerId(ctx.user.discordId),
      );
    }),
  standings: guildProcedure("competitions", "read")
    .input(z.strictObject({ guildId: DiscordGuildIdSchema, eventId: z.uuid() }))
    .query(async ({ input }) => {
      await assertDuelsEnabled(
        prisma,
        input.guildId,
        configuration.environment,
      );
      return await getDuelEventStandings(prisma, input.guildId, input.eventId);
    }),
  rollingRecords: guildProcedure("competitions", "read")
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        scope: z.enum(["individual", "pair"]),
      }),
    )
    .query(async ({ input }) => {
      await assertDuelsEnabled(
        prisma,
        input.guildId,
        configuration.environment,
      );
      return await getRollingDuelRecords(prisma, input.guildId, input.scope);
    }),
  headToHead: guildProcedure("competitions", "read")
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        scope: z.enum(["individual", "pair"]),
        firstSubjectKey: z.string().min(1).max(100),
        secondSubjectKey: z.string().min(1).max(100),
      }),
    )
    .query(async ({ input }) => {
      await assertDuelsEnabled(
        prisma,
        input.guildId,
        configuration.environment,
      );
      return await getDuelHeadToHead(prisma, input);
    }),
  reviewResult: guildMutationProcedure("competitions", "update")
    .input(
      z.strictObject({
        guildId: DiscordGuildIdSchema,
        seriesId: z.uuid(),
        idempotencyKey: z.string().min(8).max(200),
        reason: z.string().trim().min(3).max(1000),
        decision: z.discriminatedUnion("kind", [
          z.strictObject({ kind: z.literal("replay") }),
          z.strictObject({ kind: z.literal("no_contest") }),
          z.strictObject({
            kind: z.literal("advance"),
            winnerCompetitorId: z.uuid(),
          }),
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDuelsEnabled(
        prisma,
        input.guildId,
        configuration.environment,
      );
      try {
        const result = await decideDuelSeries(prisma, {
          guildId: input.guildId,
          seriesId: input.seriesId,
          actorDiscordId: viewerId(ctx.user.discordId),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          decision: input.decision,
        });
        await signalDuelSeries({
          stage: configuration.environment,
          requestId: input.idempotencyKey,
          seriesId: result.seriesId,
          deadlineAt: result.deadlineAt,
        });
        if (result.seriesComplete && result.eventId !== null) {
          await advanceDuelEvent(result.eventId, configuration.environment);
        }
        return { decided: true };
      } catch (error) {
        return domainError(error);
      }
    }),
});
