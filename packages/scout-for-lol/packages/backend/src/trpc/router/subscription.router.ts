/**
 * Web-UI subscription management. Mirrors the Discord /subscription
 * command surface (list/add/remove/add-channel/move) one-to-one, but
 * gated by web session + per-guild Administrator + CSRF for mutations.
 *
 * Every state-changing procedure runs the domain mutation AND the audit
 * row insert inside a single Prisma transaction so they commit
 * atomically — either both land or neither does.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RegionSchema,
  RiotIdSchema,
  DiscordAccountIdSchema,
} from "@scout-for-lol/data";
import { router, webProcedure, webMutationProcedure } from "#src/trpc/trpc.ts";
import {
  assertChannelInGuild,
  assertGuildAdmin,
} from "#src/trpc/guild-guard.ts";
import { prisma } from "#src/database/index.ts";
import {
  addSubscription,
  resolveSubscriptionPuuid,
  runBackfillAfterCommit,
} from "#src/lib/subscription/add.ts";
import type { AddSubscriptionResult } from "#src/lib/subscription/types.ts";
import { removeSubscription } from "#src/lib/subscription/remove.ts";
import { moveSubscription } from "#src/lib/subscription/move.ts";
import { addSubscriptionChannel } from "#src/lib/subscription/add-channel.ts";
import { listSubscriptions } from "#src/lib/subscription/list.ts";
import { recordAudit, AuditActionSchema } from "#src/lib/audit/index.ts";

const GuildIdInput = z.object({ guildId: DiscordGuildIdSchema });

export const subscriptionRouter = router({
  list: webProcedure.input(GuildIdInput).query(async ({ ctx, input }) => {
    await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
    return listSubscriptions({ guildId: input.guildId });
  }),

  listAuditLog: webProcedure
    .input(
      GuildIdInput.extend({
        limit: z.number().int().min(1).max(500).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const rows = await prisma.auditLog.findMany({
        where: { serverId: input.guildId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
      return rows.map((r) => {
        // AuditLog.payload is a free-form JSON string. Old / malformed
        // rows must not break the whole list — fall back to a synthetic
        // object so a single bad payload doesn't take the whole page down.
        let payload: unknown;
        try {
          payload = JSON.parse(r.payload);
        } catch {
          payload = { _parseError: true, raw: r.payload.slice(0, 200) };
        }
        const actionResult = AuditActionSchema.safeParse(r.action);
        return {
          id: r.id,
          createdAt: r.createdAt,
          actorDiscordId: r.actorDiscordId,
          action: actionResult.success ? actionResult.data : r.action,
          targetChannelId: r.targetChannelId,
          targetPlayerId: r.targetPlayerId,
          targetAccountId: r.targetAccountId,
          payload,
        };
      });
    }),

  add: webMutationProcedure
    .input(
      z.object({
        guildId: DiscordGuildIdSchema,
        channelId: DiscordChannelIdSchema,
        region: RegionSchema,
        riotId: RiotIdSchema,
        alias: z.string().min(1),
        discordUserId: DiscordAccountIdSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.channelId,
      });
      const actorDiscordId = ctx.user.discordId;

      // Riot lookup runs OUTSIDE the transaction — Prisma's 5s tx
      // timeout vs. Riot's 1-3s typical (with occasional spikes) would
      // trip P2028 Transaction already closed for slow upstreams.
      const puuidResult = await resolveSubscriptionPuuid(
        input.riotId,
        input.region,
      );
      if (puuidResult.kind !== "ok") {
        const notFound: AddSubscriptionResult = {
          kind: "riot-id-not-found",
          message: puuidResult.message,
        };
        return notFound;
      }
      const puuid = puuidResult.puuid;

      const result = await prisma.$transaction(async (tx) => {
        const r = await addSubscription(
          {
            guildId: input.guildId,
            channelId: input.channelId,
            region: input.region,
            riotId: input.riotId,
            alias: input.alias,
            discordUserId: input.discordUserId,
            creatorDiscordId: actorDiscordId,
          },
          puuid,
          tx,
        );

        if (r.kind === "created") {
          await recordAudit(
            {
              action: "SUBSCRIPTION_ADD",
              actorDiscordId,
              serverId: input.guildId,
              targetChannelId: input.channelId,
              targetPlayerId: r.player.id,
              targetAccountId: r.account.id,
              payload: {
                riotId: input.riotId,
                region: input.region,
                alias: input.alias,
                isAddingToExistingPlayer: r.isAddingToExistingPlayer,
              },
              ipAddress: ctx.webSession.ipAddress,
              userAgent: ctx.webSession.userAgent,
            },
            tx,
          );
        }

        return r;
      });

      if (result.kind === "created") {
        // Best-effort match-history backfill so the poll cycle doesn't
        // emit notifications for historical matches the first time it
        // encounters the account. Fire-and-forget; never block the
        // mutation response on it.
        void runBackfillAfterCommit({
          alias: input.alias,
          puuid,
          region: input.region,
          discordUserId: input.discordUserId,
        });
      }

      return result;
    }),

  remove: webMutationProcedure
    .input(
      z.object({
        guildId: DiscordGuildIdSchema,
        channelId: DiscordChannelIdSchema,
        alias: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      const actorDiscordId = ctx.user.discordId;

      return prisma.$transaction(async (tx) => {
        const result = await removeSubscription(
          {
            guildId: input.guildId,
            channelId: input.channelId,
            alias: input.alias,
            actorDiscordId,
          },
          tx,
        );

        if (result.kind === "removed") {
          await recordAudit(
            {
              action: "SUBSCRIPTION_REMOVE",
              actorDiscordId,
              serverId: input.guildId,
              targetChannelId: input.channelId,
              payload: {
                alias: input.alias,
                remainingChannelIds: result.remainingChannelIds,
              },
              ipAddress: ctx.webSession.ipAddress,
              userAgent: ctx.webSession.userAgent,
            },
            tx,
          );
        }

        return result;
      });
    }),

  addChannel: webMutationProcedure
    .input(
      z.object({
        guildId: DiscordGuildIdSchema,
        alias: z.string().min(1),
        channelId: DiscordChannelIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.channelId,
      });
      const actorDiscordId = ctx.user.discordId;

      return prisma.$transaction(async (tx) => {
        const result = await addSubscriptionChannel(
          {
            guildId: input.guildId,
            alias: input.alias,
            channelId: input.channelId,
            actorDiscordId,
          },
          tx,
        );

        if (result.kind === "added") {
          await recordAudit(
            {
              action: "SUBSCRIPTION_ADD_CHANNEL",
              actorDiscordId,
              serverId: input.guildId,
              targetChannelId: input.channelId,
              payload: { alias: input.alias },
              ipAddress: ctx.webSession.ipAddress,
              userAgent: ctx.webSession.userAgent,
            },
            tx,
          );
        }

        return result;
      });
    }),

  move: webMutationProcedure
    .input(
      z.object({
        guildId: DiscordGuildIdSchema,
        alias: z.string().min(1),
        fromChannelId: DiscordChannelIdSchema,
        toChannelId: DiscordChannelIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.fromChannelId,
      });
      assertChannelInGuild({
        guildId: input.guildId,
        channelId: input.toChannelId,
      });
      const actorDiscordId = ctx.user.discordId;

      if (input.fromChannelId === input.toChannelId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Source and destination channels are the same",
        });
      }

      return prisma.$transaction(async (tx) => {
        const result = await moveSubscription(
          {
            guildId: input.guildId,
            alias: input.alias,
            fromChannelId: input.fromChannelId,
            toChannelId: input.toChannelId,
            actorDiscordId,
          },
          tx,
        );

        if (result.kind === "moved") {
          await recordAudit(
            {
              action: "SUBSCRIPTION_MOVE",
              actorDiscordId,
              serverId: input.guildId,
              payload: {
                alias: input.alias,
                fromChannelId: input.fromChannelId,
                toChannelId: input.toChannelId,
              },
              ipAddress: ctx.webSession.ipAddress,
              userAgent: ctx.webSession.userAgent,
            },
            tx,
          );
        }

        return result;
      });
    }),
});
