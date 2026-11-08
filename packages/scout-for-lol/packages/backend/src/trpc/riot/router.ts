import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { completeRiotLink } from "#src/database/riot-accounts.ts";
import { router, webProcedure, webMutationProcedure } from "#src/trpc/trpc.ts";
import { decryptRiotLinkFlow } from "./link-cookie.ts";

export const riotAccountRouter = router({
  list: webProcedure.query(async ({ ctx }) => {
    const accounts = await prisma.riotAccountPreference.findMany({
      where: { ownerDiscordId: ctx.user.discordId },
      orderBy: [{ createdAt: "asc" }, { puuid: "asc" }],
      select: {
        puuid: true,
        gameName: true,
        tagLine: true,
        verifiedAt: true,
        matchNotificationsEnabled: true,
      },
    });
    return {
      accounts: accounts.map((account) => ({
        ...account,
        puuid: LeaguePuuidSchema.parse(account.puuid),
        verifiedAt: account.verifiedAt.toISOString(),
      })),
      linkingEnabled: await isPolicyEnabled("riot_account_linking_enabled", {
        user: ctx.webSession.discordId,
        stage: configuration.environment,
      }),
      linkingConfigured:
        configuration.riotRsoClientId !== undefined &&
        configuration.riotRsoClientSecret !== undefined,
    };
  }),
  completeLink: webMutationProcedure.mutation(async ({ ctx }) => {
    const secret = configuration.jwtSigningSecret;
    if (secret === undefined)
      throw new Error("Riot linking requires the session signing secret");
    const flow = await decryptRiotLinkFlow(
      ctx.webSession.riotLinkCookie,
      secret,
    );
    if (flow === null || ctx.webSession.sessionId === undefined)
      return { kind: "expired" };
    const kind = await completeRiotLink(
      {
        state: flow.state,
        discordId: ctx.user.discordId,
        sessionId: ctx.webSession.sessionId,
      },
      prisma,
    );
    return { kind };
  }),
  setMatchNotifications: webMutationProcedure
    .input(z.object({ puuid: LeaguePuuidSchema, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await prisma.riotAccountPreference.updateMany({
        where: { puuid: input.puuid, ownerDiscordId: ctx.user.discordId },
        data: { matchNotificationsEnabled: input.enabled },
      });
      if (updated.count !== 1)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Verify ownership of this Riot account before changing its notifications.",
        });
      return { enabled: input.enabled };
    }),
});
