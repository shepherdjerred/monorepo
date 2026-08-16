import {
  CustomAuditEventSchema,
  CustomGameSnapshotSchema,
  CustomNightSnapshotSchema,
} from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { getCustomNight } from "#src/customs/repository.ts";
import { prisma } from "#src/database/index.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";
import { webProcedure } from "#src/trpc/trpc.ts";

async function assertWebCustomsMember(params: {
  guildId: string;
  user: Parameters<typeof fetchUserGuildsForRequest>[0];
}): Promise<void> {
  if (configuration.customs?.guildAllowlist.includes(params.guildId) !== true) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout Customs is not enabled for this guild",
    });
  }
  const guilds = await fetchUserGuildsForRequest(params.user);
  if (!guilds.some((guild) => guild.id === params.guildId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this guild",
    });
  }
}

async function loadCustomsHistory(guildId: string) {
  const rows = await prisma.customNight.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) =>
    CustomNightSnapshotSchema.parse(JSON.parse(row.snapshot)),
  );
}

async function loadCustomsHistoryDetail(params: {
  guildId: string;
  nightId: string;
}) {
  const snapshot = await getCustomNight(prisma, params.nightId);
  if (snapshot?.guildId !== params.guildId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Custom night not found",
    });
  }
  const [gameRows, auditRows] = await Promise.all([
    prisma.customGame.findMany({
      where: { nightId: params.nightId },
      orderBy: { sequence: "asc" },
    }),
    prisma.customAuditEvent.findMany({
      where: { nightId: params.nightId },
      orderBy: { revision: "asc" },
    }),
  ]);
  return {
    night: snapshot,
    games: gameRows.map((row) =>
      CustomGameSnapshotSchema.parse(JSON.parse(row.snapshot)),
    ),
    audit: auditRows.map((row) =>
      CustomAuditEventSchema.parse({
        ...row,
        actorDiscordId: row.actorId,
        payload: JSON.parse(row.payload),
        createdAt: row.createdAt.toISOString(),
      }),
    ),
  };
}

export const customsHistoryDetailProcedure = webProcedure
  .input(z.object({ guildId: z.string().min(1), nightId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    await assertWebCustomsMember({ guildId: input.guildId, user: ctx.user });
    return await loadCustomsHistoryDetail(input);
  });

export const customsHistoryBootstrapProcedure = webProcedure
  .input(z.object({ guildId: z.string().min(1) }))
  .query(async ({ ctx, input }) => {
    await assertWebCustomsMember({ guildId: input.guildId, user: ctx.user });
    const nights = await loadCustomsHistory(input.guildId);
    const initialNight = nights[0];
    return {
      nights,
      initialDetail:
        initialNight === undefined
          ? null
          : await loadCustomsHistoryDetail({
              guildId: input.guildId,
              nightId: initialNight.id,
            }),
    };
  });
