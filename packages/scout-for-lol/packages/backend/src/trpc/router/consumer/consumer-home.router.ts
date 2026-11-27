import { assertConsumerPlayerScope } from "#src/consumer/player-access.ts";
import { getConsumerHome } from "#src/trpc/router/consumer/home/home-overview.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

/**
 * The Home page's endpoint. Scope is the usual consumer scope, re-resolved on
 * every request: Discord membership and the rollout flag per server. Nothing
 * outside the viewer's servers is read, and nothing about the viewer is kept.
 */
export const consumerHomeRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const guilds = await assertConsumerPlayerScope(ctx.user);
    return await getConsumerHome({
      viewer: {
        discordId: ctx.user.discordId,
        discordUsername: ctx.user.discordUsername,
      },
      guilds,
    });
  }),
});
