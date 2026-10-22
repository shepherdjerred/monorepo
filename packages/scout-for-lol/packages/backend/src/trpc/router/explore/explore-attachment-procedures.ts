/**
 * Images attached to an Explore question, uploaded before it is sent.
 *
 * Its own module rather than more of `explore.router.ts`, which is close to
 * the 500-line cap.
 */

import { prisma } from "#src/database/index.ts";
import {
  ExploreAttachmentUploadSchema,
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

export const exploreAttachmentProcedures = { uploadAttachment };
