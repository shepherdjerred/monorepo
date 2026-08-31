import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CustomHistoryListSchema,
  CustomHistorySchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  buildCustomNightHistory,
  buildCustomNightSnapshot,
} from "#src/customs/snapshot.ts";
import { anonymizeCustomParticipant } from "#src/customs/anonymize.ts";
import {
  guildMutationProcedure,
  guildProcedure,
} from "#src/trpc/guild-permission.ts";
import { router } from "#src/trpc/trpc.ts";

const GuildInputSchema = z.object({ guildId: DiscordGuildIdSchema });
const DetailInputSchema = GuildInputSchema.extend({ nightId: z.uuid() });

async function assertCustomsHistoryEnabled(
  guildId: DiscordGuildId,
): Promise<void> {
  if (!(await isPolicyEnabled("custom_nights_enabled", { server: guildId }))) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Customs is unavailable",
    });
  }
}

export const customsHistoryRouter = router({
  list: guildProcedure("customs", "read")
    .input(GuildInputSchema)
    .query(async ({ ctx, input }) => {
      await assertCustomsHistoryEnabled(input.guildId);
      const nights = await prisma.customNight.findMany({
        where: { guildId: input.guildId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true },
      });
      const snapshots = await Promise.all(
        nights.map((night) =>
          buildCustomNightSnapshot(prisma, night.id, ctx.user.discordId),
        ),
      );
      return CustomHistoryListSchema.parse(
        snapshots.filter((snapshot) => snapshot !== undefined),
      );
    }),
  detail: guildProcedure("customs", "read")
    .input(DetailInputSchema)
    .query(async ({ ctx, input }) => {
      await assertCustomsHistoryEnabled(input.guildId);
      const belongs = await prisma.customNight.count({
        where: { id: input.nightId, guildId: input.guildId },
      });
      if (belongs !== 1) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom night not found",
        });
      }
      const history = await buildCustomNightHistory(
        prisma,
        input.nightId,
        ctx.user.discordId,
      );
      if (history === undefined) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Custom night not found",
        });
      }
      return CustomHistorySchema.parse(history);
    }),
  anonymize: guildMutationProcedure("customs", "manage")
    .input(GuildInputSchema.extend({ discordId: DiscordAccountIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCustomsHistoryEnabled(input.guildId);
      return anonymizeCustomParticipant(prisma, {
        guildId: input.guildId,
        discordId: input.discordId,
        operatorId: ctx.user.discordId,
      });
    }),
});
