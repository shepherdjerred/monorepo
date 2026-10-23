/**
 * Images attached to an Explore question, uploaded before it is sent.
 *
 * Its own module rather than more of `explore.router.ts`, which is close to
 * the 500-line cap.
 */

import { z } from "zod";
import { EXPLORE_MAX_ATTACHMENTS } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  discardExploreAttachment,
  ExploreAttachmentUploadSchema,
  holdExploreAttachments,
  uploadExploreAttachment,
} from "#src/explore/attachments/storage.ts";
import { requireExploreUserAndGuilds } from "#src/trpc/router/explore/explore-intent-access.ts";
import { webMutationProcedure } from "#src/trpc/trpc.ts";

const uploadAttachment = webMutationProcedure
  .input(ExploreAttachmentUploadSchema)
  .mutation(async ({ ctx, input }) => {
    const { userId } = await requireExploreUserAndGuilds(ctx.user);
    return await uploadExploreAttachment(prisma, userId, input);
  });

/** Removing an image from the composer frees its unsent-upload slot. */
const discardAttachment = webMutationProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .mutation(async ({ ctx, input }) => {
    const { userId } = await requireExploreUserAndGuilds(ctx.user);
    return {
      discarded: await discardExploreAttachment(prisma, userId, input.id),
    };
  });

/** An open composer renews the hold on what it shows, in every tab. */
const holdAttachments = webMutationProcedure
  .input(
    z.strictObject({
      ids: z
        .array(z.uuid())
        .min(1)
        .max(2 * EXPLORE_MAX_ATTACHMENTS),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { userId } = await requireExploreUserAndGuilds(ctx.user);
    await holdExploreAttachments(prisma, userId, input.ids);
    return { held: true };
  });

export const exploreAttachmentProcedures = {
  uploadAttachment,
  discardAttachment,
  holdAttachments,
};
