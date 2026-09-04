import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  BucksParlaySideSchema,
  BucksDareV2StateSchema,
  BucksPoolRosterSchema,
  BucksStakeSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  RiotTeamIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { captureBucksMemberActivity } from "#src/analytics/bryan-bucks.ts";
import type { BucksMemberActivityKind } from "#src/analytics/product-analytics.ts";
import {
  findEligiblePlayer,
  getLedgerPage,
  getPersonalBucksView,
} from "#src/betting/accounts.ts";
import { cancelBet } from "#src/betting/cancel-bet.ts";
import { bettingAnchor } from "#src/betting/components.ts";
import {
  inspectVisibleDareV2,
  listVisibleDarePageV2,
} from "#src/betting/dare-view-v2.ts";
import { cancellationHouseCut } from "#src/betting/house-cut.ts";
import { refreshBucksMessages } from "#src/betting/message-refresh.ts";
import { ledgerKindLabel } from "#src/betting/navigation.ts";
import { getOpenMarketsView } from "#src/betting/open-market-view.ts";
import { placeBet } from "#src/betting/place-bet.ts";
import { placeParlayBet } from "#src/betting/parlay-place-bet.ts";
import { refreshParlayMessages } from "#src/betting/parlay-refresh.ts";
import { subjectWinsForTeam } from "#src/betting/team.ts";
import { placeWeeklyParlayBet } from "#src/betting/weekly-parlay-bet.ts";
import { getLatestWeeklyLeaderboardSnapshot } from "#src/betting/weekly-leaderboard-snapshot.ts";
import { refreshWeeklyParlayMessage } from "#src/betting/weekly-parlay-refresh.ts";
import {
  assertBucksGuildMembership,
  assertBucksScope,
  resolveBucksScope,
} from "#src/consumer/bucks-access.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import {
  DareDraftEditorInputSchema,
  DareDraftPreviewInputSchema,
  previewDareDraftEditorV2,
  reviseDareDraftEditorV2,
  validateDareDraftEditorV2,
} from "#src/explore/dare-editor-v2.ts";
import { router, webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";
import { bucksDareActionProcedures } from "#src/trpc/router/bucks-dare-action-procedures.ts";
import { bucksNotificationProcedures } from "#src/trpc/router/bucks-notification-procedures.ts";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const MatchInput = GuildInput.extend({
  matchId: z.string().min(1).max(64),
});
const DareListInput = GuildInput.extend({
  scope: z.enum(["mine", "guild", "needs_action"]),
  search: z.string().min(1).max(100).optional(),
  states: z.array(BucksDareV2StateSchema).max(10).optional(),
  role: z.enum(["challenger", "target", "contributor", "involved"]).optional(),
  sort: z.enum(["needs_action", "deadline", "updated"]).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const DareInspectInput = GuildInput.extend({
  dareId: z.number().int().positive(),
});
const DareDraftInput = DareDraftEditorInputSchema.extend({
  guildId: DiscordGuildIdSchema,
});
const DareDraftPreviewInput = DareDraftPreviewInputSchema.extend({
  guildId: DiscordGuildIdSchema,
});

async function dareManagementAvailable(
  guildId: DiscordGuildId,
  viewerDiscordId: DiscordAccountId,
): Promise<boolean> {
  const [dareEnabled, sqlV3Enabled, relationalEnabled, existingDare] =
    await Promise.all([
      isPolicyEnabled("dare_v2", { server: guildId }),
      isPolicyEnabled("dare_extended_contracts_enabled", { server: guildId }),
      isPolicyEnabled("scoutql_relational_enabled", { server: guildId }),
      prisma.bucksDareV2.findFirst({
        where: {
          serverId: guildId,
          dareState: { not: "deleted" },
          OR: [
            { dareState: { not: "draft" } },
            { challengerDiscordId: viewerDiscordId },
          ],
        },
        select: { id: true },
      }),
    ]);
  return (
    ((dareEnabled || sqlV3Enabled) && relationalEnabled) ||
    existingDare !== null
  );
}

/**
 * Best-effort member-activity analytics for a completed web mutation.
 *
 * The domain result unions treat refusals (window closed, insufficient
 * balance) as ordinary answers, so they are captured as `success` handling —
 * exactly as the Discord button surface does. Auth/infra failures throw before
 * this runs and are deliberately not captured.
 */
async function captureWebActivity(
  serverId: string,
  discordId: string,
  activityKind: BucksMemberActivityKind,
): Promise<void> {
  await captureBucksMemberActivity({
    serverId,
    discordId,
    activityKind,
    surface: "web",
    status: "success",
  });
}

/** Bryan Bucks web reads and domain-backed mutations, scoped by guild. */
export const bucksRouter = router({
  status: webProcedure.query(async ({ ctx }) => {
    const scope = await resolveBucksScope(ctx.user);
    if (scope.kind === "forbidden") {
      return { state: scope.reason } as const;
    }
    const viewerDiscordId = DiscordAccountIdSchema.parse(ctx.user.discordId);
    return {
      state: "available",
      guilds: await Promise.all(
        scope.guilds.map(async (guild) => ({
          id: guild.id,
          name: guild.name,
          daresAvailable: await dareManagementAvailable(
            DiscordGuildIdSchema.parse(guild.id),
            viewerDiscordId,
          ),
        })),
      ),
    } as const;
  }),

  dareList: webProcedure.input(DareListInput).query(async ({ ctx, input }) => {
    await assertBucksScope(ctx.user, input.guildId);
    return await listVisibleDarePageV2(
      {
        serverId: input.guildId,
        viewerDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        scope: input.scope,
        ...(input.search === undefined ? {} : { search: input.search }),
        ...(input.states === undefined ? {} : { states: input.states }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.sort === undefined ? {} : { sort: input.sort }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      },
      prisma,
    );
  }),

  dareInspect: webProcedure
    .input(DareInspectInput)
    .query(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const dare = await inspectVisibleDareV2(
        {
          dareId: input.dareId,
          serverId: input.guildId,
          viewerDiscordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        },
        prisma,
      );
      if (dare === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dare not found." });
      }
      return dare;
    }),

  ...bucksDareActionProcedures,
  ...bucksNotificationProcedures,

  dareValidateDraft: webProcedure
    .input(DareDraftInput)
    .query(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const { guildId, ...draft } = input;
      return await validateDareDraftEditorV2(
        draft,
        DiscordAccountIdSchema.parse(ctx.user.discordId),
        [guildId],
      );
    }),

  darePreviewDraft: webProcedure
    .input(DareDraftPreviewInput)
    .query(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const { guildId, ...draft } = input;
      return await previewDareDraftEditorV2(
        draft,
        DiscordAccountIdSchema.parse(ctx.user.discordId),
        [guildId],
      );
    }),

  dareReviseDraft: webMutationProcedure
    .input(DareDraftInput)
    .mutation(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const { guildId, ...draft } = input;
      return await reviseDareDraftEditorV2(
        draft,
        DiscordAccountIdSchema.parse(ctx.user.discordId),
        [guildId],
      );
    }),

  wallet: webProcedure.input(GuildInput).query(async ({ ctx, input }) => {
    await assertBucksScope(ctx.user, input.guildId);
    const discordId = DiscordAccountIdSchema.parse(ctx.user.discordId);
    const [eligible, view] = await Promise.all([
      findEligiblePlayer({ serverId: input.guildId, discordId }),
      getPersonalBucksView({ serverId: input.guildId, discordId }),
    ]);
    return {
      eligible: eligible !== undefined,
      wallet:
        view === undefined
          ? null
          : {
              ...view,
              pendingPositions: view.pendingPositions.map((position) =>
                position.marketType === "outcome"
                  ? {
                      ...position,
                      // Cancellation exists only while the window is open AND
                      // still before its deadline — `poolState` alone can lag
                      // a passed `closesAt` until the sweep runs, and
                      // `cancelBet` itself requires `closesAt > now`. A locked
                      // position carries no fee quote.
                      cancellationFee:
                        position.poolState === "open" &&
                        position.closesAt.getTime() > Date.now()
                          ? cancellationHouseCut(position.offeredStake)
                          : null,
                    }
                  : position,
              ),
            },
    };
  }),

  ledger: webProcedure
    .input(
      GuildInput.extend({
        page: z.number().int().nonnegative().max(100_000),
        snapshotId: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const discordId = DiscordAccountIdSchema.parse(ctx.user.discordId);
      const page = await getLedgerPage({
        serverId: input.guildId,
        discordId,
        page: input.page,
        ...(input.snapshotId === undefined
          ? {}
          : { snapshotId: input.snapshotId }),
      });
      return {
        ...page,
        // The raw `context` JSON stays server-side: the history list renders
        // kind label, delta, balance and date, and the self-describing context
        // union includes legacy shapes the SPA has no business re-validating.
        entries: page.entries.map(({ context: _context, ...entry }) => ({
          ...entry,
          label: ledgerKindLabel(entry.kind),
        })),
      };
    }),

  openMarkets: webProcedure.input(GuildInput).query(async ({ ctx, input }) => {
    await assertBucksScope(ctx.user, input.guildId);
    const discordId = DiscordAccountIdSchema.parse(ctx.user.discordId);
    return await getOpenMarketsView({ serverId: input.guildId, discordId });
  }),

  leaderboard: webProcedure.input(GuildInput).query(async ({ ctx, input }) => {
    await assertBucksScope(ctx.user, input.guildId);
    const snapshot = await getLatestWeeklyLeaderboardSnapshot({
      serverId: input.guildId,
    });
    if (snapshot === undefined) {
      return { kind: "none" } as const;
    }
    return {
      kind: "snapshot",
      postedAt: snapshot.postedAt,
      entries: snapshot.entries,
    } as const;
  }),

  placeOutcomeBet: webMutationProcedure
    .input(
      MatchInput.extend({
        teamId: RiotTeamIdSchema,
        stake: BucksStakeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const discordId = DiscordAccountIdSchema.parse(ctx.user.discordId);

      // The web names Blue/Red directly, while `placeBet` speaks the v1
      // subject-relative contract — so the anchor is resolved from the pool's
      // frozen roster exactly as the market message's buttons do.
      const pool = await prisma.bucksMatchPool.findUnique({
        where: {
          matchId_serverId: {
            matchId: input.matchId,
            serverId: input.guildId,
          },
        },
        select: { roster: true },
      });
      if (pool === null) {
        return { kind: "no_pool" } as const;
      }
      const roster = BucksPoolRosterSchema.parse(
        JSON.parse(pool.roster),
      ).participants;
      const anchor = bettingAnchor(roster);
      if (anchor === undefined) {
        // A pool exists only for a tracked game, so a roster with no bettable
        // anchor behaves like the pool being gone rather than a new refusal.
        return { kind: "no_pool" } as const;
      }
      const anchorPuuid = roster[anchor.index]?.puuid ?? null;
      if (anchorPuuid === null) {
        throw new Error(
          `Bryan Bucks betting anchor for ${input.matchId} disappeared from its frozen roster`,
        );
      }

      const result = await placeBet({
        matchId: input.matchId,
        serverId: input.guildId,
        discordId,
        subjectPuuid: anchorPuuid,
        subjectWins: subjectWinsForTeam(anchor.teamId, input.teamId),
        stake: input.stake,
        surface: "web",
      });
      if (result.kind === "placed") {
        await refreshBucksMessages({
          matchId: input.matchId,
          serverId: input.guildId,
        });
      }
      await captureWebActivity(input.guildId, discordId, "outcome_bet");
      return result;
    }),

  cancelOutcomeBet: webMutationProcedure
    .input(MatchInput)
    .mutation(async ({ ctx, input }) => {
      // Cancellation must survive the guild's flag being revoked mid-match —
      // see assertBucksGuildMembership. Membership alone still stops an
      // arbitrary guildId; cancelBet itself further requires the caller own
      // an open position in that exact pool.
      await assertBucksGuildMembership(ctx.user, input.guildId);
      const discordId = DiscordAccountIdSchema.parse(ctx.user.discordId);
      const result = await cancelBet({
        matchId: input.matchId,
        serverId: input.guildId,
        discordId,
        surface: "web",
      });
      if (result.kind === "cancelled") {
        // A withdrawn offer must disappear from the public market digest.
        await refreshBucksMessages({
          matchId: input.matchId,
          serverId: input.guildId,
        });
      }
      await captureWebActivity(input.guildId, discordId, "outcome_bet");
      return result;
    }),

  placeParlayBet: webMutationProcedure
    .input(
      MatchInput.extend({
        side: BucksParlaySideSchema,
        stake: BucksStakeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const discordId = DiscordAccountIdSchema.parse(ctx.user.discordId);
      const result = await placeParlayBet({
        matchId: input.matchId,
        serverId: input.guildId,
        discordId,
        side: input.side,
        stake: input.stake,
        surface: "web",
      });
      if (result.kind === "placed") {
        await refreshParlayMessages({
          matchId: input.matchId,
          serverId: input.guildId,
        });
      }
      await captureWebActivity(input.guildId, discordId, "parlay_bet");
      return result;
    }),

  placeWeeklyParlayBet: webMutationProcedure
    .input(
      GuildInput.extend({
        marketId: z.number().int().positive(),
        side: BucksParlaySideSchema,
        stake: BucksStakeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const discordId = DiscordAccountIdSchema.parse(ctx.user.discordId);
      // `placeWeeklyParlayBet` validates that the market belongs to this guild
      // and requires both betting flags internally.
      const result = await placeWeeklyParlayBet({
        marketId: input.marketId,
        serverId: input.guildId,
        discordId,
        side: input.side,
        stake: input.stake,
        surface: "web",
      });
      if (result.kind === "placed") {
        await refreshWeeklyParlayMessage(input.marketId);
      }
      await captureWebActivity(input.guildId, discordId, "weekly_parlay_bet");
      return result;
    }),
});
