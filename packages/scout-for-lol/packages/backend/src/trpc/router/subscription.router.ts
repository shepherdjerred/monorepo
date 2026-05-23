/**
 * Web-UI subscription management. Mirrors the Discord /subscription
 * command surface (list/add/remove/add-channel/move) one-to-one, but
 * gated by web session + per-guild Administrator + CSRF for mutations.
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
import { assertGuildAdmin } from "#src/trpc/guild-guard.ts";
import { prisma } from "#src/database/index.ts";
import { addSubscription } from "#src/lib/subscription/add.ts";
import { removeSubscription } from "#src/lib/subscription/remove.ts";
import { moveSubscription } from "#src/lib/subscription/move.ts";
import { addSubscriptionChannel } from "#src/lib/subscription/add-channel.ts";
import { listSubscriptions } from "#src/lib/subscription/list.ts";
import { recordAudit } from "#src/lib/audit/index.ts";

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
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        actorDiscordId: r.actorDiscordId,
        action: r.action,
        targetChannelId: r.targetChannelId,
        targetPlayerId: r.targetPlayerId,
        targetAccountId: r.targetAccountId,
        payload: JSON.parse(r.payload),
      }));
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
      const actorDiscordId = ctx.user.discordId;

      const result = await addSubscription({
        guildId: input.guildId,
        channelId: input.channelId,
        region: input.region,
        riotId: input.riotId,
        alias: input.alias,
        discordUserId: input.discordUserId,
        creatorDiscordId: actorDiscordId,
      });

      if (result.kind === "created") {
        await recordAudit({
          action: "SUBSCRIPTION_ADD",
          actorDiscordId,
          serverId: input.guildId,
          targetChannelId: input.channelId,
          targetPlayerId: result.player.id,
          targetAccountId: result.account.id,
          payload: {
            riotId: input.riotId,
            region: input.region,
            alias: input.alias,
            isAddingToExistingPlayer: result.isAddingToExistingPlayer,
          },
          ipAddress: ctx.webSession.ipAddress,
          userAgent: ctx.webSession.userAgent,
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

      const result = await removeSubscription({
        guildId: input.guildId,
        channelId: input.channelId,
        alias: input.alias,
        actorDiscordId,
      });

      if (result.kind === "removed") {
        await recordAudit({
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
        });
      }

      return result;
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
      const actorDiscordId = ctx.user.discordId;

      const result = await addSubscriptionChannel({
        guildId: input.guildId,
        alias: input.alias,
        channelId: input.channelId,
        actorDiscordId,
      });

      if (result.kind === "added") {
        await recordAudit({
          action: "SUBSCRIPTION_ADD_CHANNEL",
          actorDiscordId,
          serverId: input.guildId,
          targetChannelId: input.channelId,
          payload: { alias: input.alias },
          ipAddress: ctx.webSession.ipAddress,
          userAgent: ctx.webSession.userAgent,
        });
      }

      return result;
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
      const actorDiscordId = ctx.user.discordId;

      if (input.fromChannelId === input.toChannelId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Source and destination channels are the same",
        });
      }

      const result = await moveSubscription({
        guildId: input.guildId,
        alias: input.alias,
        fromChannelId: input.fromChannelId,
        toChannelId: input.toChannelId,
        actorDiscordId,
      });

      if (result.kind === "moved") {
        await recordAudit({
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
        });
      }

      return result;
    }),
});
