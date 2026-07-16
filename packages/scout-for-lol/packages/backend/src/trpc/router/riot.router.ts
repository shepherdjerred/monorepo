/**
 * Riot ID lookup/search procedures for the web UI add flows.
 */

import { z } from "zod";
import { DiscordGuildIdSchema, RegionSchema } from "@scout-for-lol/data";
import { router, webProcedure } from "#src/trpc/trpc.ts";
import { assertGuildAdmin } from "#src/trpc/guild-guard.ts";
import {
  ResolveRiotIdInput,
  resolveRiotIdExact,
} from "#src/lib/player-admin/riot-search.ts";
import { searchSummoners } from "#src/lib/riot/summoner-search.ts";

export const riotRouter = router({
  /** Exact Riot ID → PUUID/canonical name. Read-only; debounce on the client. */
  resolveRiotId: webProcedure
    .input(ResolveRiotIdInput)
    .query(async ({ ctx, input }) => resolveRiotIdExact(ctx, input)),

  /**
   * Partial-name summoner suggestions for the add flow: our own summoner index
   * first, then OP.GG. Unverified — the picked Riot ID is confirmed via Riot's
   * official API before it's stored.
   */
  searchSummoners: webProcedure
    .input(
      z.object({
        guildId: DiscordGuildIdSchema,
        query: z.string().trim().min(2).max(100),
        region: RegionSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertGuildAdmin({ user: ctx.user, guildId: input.guildId });
      return searchSummoners(input.query, input.region);
    }),
});
