/**
 * Feedback Router
 *
 * Somewhere for user feedback to actually land.
 *
 * Every prior route was a one-way DM that ended in "DM a human directly" — a
 * manual hop with no record, which is a large part of why essentially no
 * feedback was ever received. This one persists.
 */

import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { router, webMutationProcedure } from "#src/trpc/trpc.ts";
import { prisma } from "#src/database/index.ts";
import { feedbackSubmittedTotal } from "#src/metrics/web.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("feedback-router");

export const feedbackRouter = router({
  submit: webMutationProcedure
    .input(
      z.object({
        // Bounded so a single submission can't be used to write unbounded data.
        body: z.string().trim().min(1).max(4000),
        rating: z.number().int().min(1).max(5).optional(),
        serverId: DiscordGuildIdSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await prisma.feedback.create({
        data: {
          discordId: ctx.user.discordId,
          serverId: input.serverId ?? null,
          rating: input.rating ?? null,
          body: input.body,
        },
        select: { id: true },
      });

      feedbackSubmittedTotal.inc({
        rated: input.rating === undefined ? "no" : "yes",
      });
      logger.info(
        `Feedback #${created.id.toString()} submitted by ${ctx.user.discordId}`,
      );
      return { id: created.id };
    }),
});
