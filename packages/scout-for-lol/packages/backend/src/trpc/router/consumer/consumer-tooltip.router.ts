import { z } from "zod";
import {
  ChampionIdSchema,
  PlayerIdSchema,
  PlayerProfileQueueSelectionSchema,
} from "@scout-for-lol/data";
import { getChampionTooltipFacts } from "#src/trpc/router/consumer/tooltip/champion-facts.ts";
import { getPlayerTooltipFacts } from "#src/trpc/router/consumer/tooltip/player-facts.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

const FactsInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("champion"),
    championId: ChampionIdSchema,
    /** The page's queue filter, so the hover agrees with the page. */
    queues: PlayerProfileQueueSelectionSchema.optional(),
  }),
  z.object({ kind: z.literal("player"), playerId: PlayerIdSchema }),
]);

/**
 * The "what Scout knows" block of a rich tooltip, fetched once per hover for
 * a champion or a player; the page supplies every other entity's block.
 *
 * Scope is the usual consumer scope, re-resolved on every request. Reads are
 * bounded to the last 90 days and take at most one lake slot; nothing about
 * the viewer is stored.
 */
export const consumerTooltipRouter = router({
  facts: protectedProcedure.input(FactsInput).query(async ({ ctx, input }) => {
    const nowMs = Date.now();
    return input.kind === "champion"
      ? await getChampionTooltipFacts({
          user: ctx.user,
          championId: input.championId,
          queues: input.queues,
          nowMs,
        })
      : await getPlayerTooltipFacts({
          user: ctx.user,
          playerId: input.playerId,
          nowMs,
        });
  }),
});
