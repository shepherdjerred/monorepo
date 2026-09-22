import { z } from "zod";
import { DiscordGuildIdSchema, MatchIdSchema } from "@scout-for-lol/data";
import { isMvpVotesEnabledForGuild } from "#src/mvp-votes/eligibility.ts";
import { loadMatchMvpTallyForGuilds } from "#src/mvp-votes/query/tally.ts";
import { guildFeatureStatus } from "#src/trpc/guild-feature-status.ts";
import { router, webProcedure } from "#src/trpc/trpc.ts";

const MatchTallyInput = z.strictObject({ matchId: MatchIdSchema });

/**
 * Read-only community MVP tally for the signed-in viewer's enabled guilds.
 * Voting stays on Discord. Null when there is no contest or none of the
 * viewer's `mvp_votes_enabled` guilds have votes on this match.
 */
export const mvpVotesRouter = router({
  status: webProcedure.query(
    async ({ ctx }) =>
      await guildFeatureStatus(ctx.user, isMvpVotesEnabledForGuild),
  ),
  matchTally: webProcedure
    .input(MatchTallyInput)
    .query(async ({ ctx, input }) => {
      const status = await guildFeatureStatus(
        ctx.user,
        isMvpVotesEnabledForGuild,
      );
      if (status.state !== "available") {
        return null;
      }
      return await loadMatchMvpTallyForGuilds({
        matchId: input.matchId,
        guilds: status.guilds.map((guild) => ({
          id: DiscordGuildIdSchema.parse(guild.id),
          name: guild.name,
        })),
      });
    }),
});
