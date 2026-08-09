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
import { router, webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";
import { prisma } from "#src/database/index.ts";
import { feedbackSubmittedTotal } from "#src/metrics/web.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("feedback-router");

export const feedbackRouter = router({
  /**
   * Whether this user has actually used Scout, i.e. created at least one
   * subscription anywhere.
   *
   * Being able to *manage* a guild is not evidence of use: someone who is an
   * admin of a server where Scout is installed but unconfigured would otherwise
   * be asked for product feedback about a product they have never seen, and
   * could permanently dismiss the one-time prompt before ever using it.
   * `creatorDiscordId` is a direct usage signal and needs no Discord round-trip.
   */
  eligibility: webProcedure.query(async ({ ctx }) => {
    const [created, promptState] = await Promise.all([
      prisma.subscription.count({
        where: { creatorDiscordId: ctx.user.discordId },
      }),
      prisma.feedbackPromptState.findUnique({
        where: { discordId: ctx.user.discordId },
      }),
    ]);
    return {
      // Both conditions are checked server-side. localStorage alone re-prompted
      // the same account on another device or after clearing site data.
      shouldAsk: created > 0 && promptState === null,
    };
  }),

  /** Record that the user dismissed the prompt without answering. */
  dismiss: webMutationProcedure.mutation(async ({ ctx }) => {
    await prisma.feedbackPromptState.upsert({
      where: { discordId: ctx.user.discordId },
      create: { discordId: ctx.user.discordId, submitted: false },
      update: {},
    });
    return { dismissed: true };
  }),

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
      // One transaction: a feedback row committed without its prompt-state row
      // would leave the account still eligible, so a retry would duplicate the
      // feedback while another device kept showing the one-time prompt.
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.feedback.create({
          data: {
            discordId: ctx.user.discordId,
            serverId: input.serverId ?? null,
            rating: input.rating ?? null,
            body: input.body,
          },
          select: { id: true },
        });
        await tx.feedbackPromptState.upsert({
          where: { discordId: ctx.user.discordId },
          create: { discordId: ctx.user.discordId, submitted: true },
          update: { submitted: true },
        });
        return row;
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
