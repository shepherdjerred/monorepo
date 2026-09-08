import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  getBucksNotificationPreferences,
  updateBucksNotificationPreferences,
} from "#src/betting/notification-preferences.ts";
import { assertBucksScope } from "#src/consumer/bucks-access.ts";
import { webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });

function publicPreferences(preferences: {
  ownBetSettlementDms: boolean;
  betsOnPlayerSettlementDms: boolean;
  dareLifecycleDms: boolean;
  dareProgressDms: boolean;
}) {
  return {
    ownBetSettlementDms: preferences.ownBetSettlementDms,
    betsOnPlayerSettlementDms: preferences.betsOnPlayerSettlementDms,
    dareLifecycleDms: preferences.dareLifecycleDms,
    dareProgressDms: preferences.dareProgressDms,
  };
}

export const bucksNotificationProcedures = {
  notificationPreferences: webProcedure
    .input(GuildInput)
    .query(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const preferences = await getBucksNotificationPreferences({
        serverId: input.guildId,
        discordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
      });
      return publicPreferences(preferences);
    }),

  setNotificationPreferences: webMutationProcedure
    .input(
      GuildInput.extend({
        ownBetSettlementDms: z.boolean().optional(),
        betsOnPlayerSettlementDms: z.boolean().optional(),
        dareLifecycleDms: z.boolean().optional(),
        dareProgressDms: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBucksScope(ctx.user, input.guildId);
      const preferences = await updateBucksNotificationPreferences({
        serverId: input.guildId,
        discordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        updates: {
          ...(input.ownBetSettlementDms === undefined
            ? {}
            : { ownBetSettlementDms: input.ownBetSettlementDms }),
          ...(input.betsOnPlayerSettlementDms === undefined
            ? {}
            : {
                betsOnPlayerSettlementDms: input.betsOnPlayerSettlementDms,
              }),
          ...(input.dareLifecycleDms === undefined
            ? {}
            : { dareLifecycleDms: input.dareLifecycleDms }),
          ...(input.dareProgressDms === undefined
            ? {}
            : { dareProgressDms: input.dareProgressDms }),
        },
      });
      return publicPreferences(preferences);
    }),
};
