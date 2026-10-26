import { assertDaresScope } from "#src/consumer/dares-access.ts";
import {
  getDareNotificationPreferences,
  updateDareNotificationPreferences,
} from "#src/dares/notification-preferences.ts";
import { webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
export const dareNotificationProcedures = {
  notificationPreferences: webProcedure
    .input(GuildInput)
    .query(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      return await getDareNotificationPreferences({
        serverId: input.guildId,
        discordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
      });
    }),
  setNotificationPreferences: webMutationProcedure
    .input(
      GuildInput.extend({
        dareLifecycleDms: z.boolean().optional(),
        dareProgressDms: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDaresScope(ctx.user, input.guildId);
      const { guildId, dareLifecycleDms, dareProgressDms } = input;
      const updates = {
        ...(dareLifecycleDms === undefined ? {} : { dareLifecycleDms }),
        ...(dareProgressDms === undefined ? {} : { dareProgressDms }),
      };
      return await updateDareNotificationPreferences({
        serverId: guildId,
        discordId: DiscordAccountIdSchema.parse(ctx.user.discordId),
        updates,
      });
    }),
};
