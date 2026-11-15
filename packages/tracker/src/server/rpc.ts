import { initTRPC, TRPCError } from "@trpc/server";
import { Prisma } from "#generated/prisma/client.ts";
import { TrackerError } from "#domain/error.ts";
import type { Issues } from "#infrastructure/issues.ts";
import type { Forum } from "#infrastructure/forum.ts";
import type { Collaboration } from "#infrastructure/collaboration.ts";
import type { Catalog } from "#infrastructure/catalog.ts";
import type { Attachments } from "#infrastructure/attachments.ts";
import { MutationSchema } from "#shared/schema.ts";

export type RouterContext = {
  forum: Forum;
  forumEnabled: () => Promise<boolean>;
  issues: Issues;
  collaboration: Collaboration;
  catalog: Catalog;
  attachments: Attachments;
  requestId: string;
  writesEnabled: () => Promise<boolean>;
  liveUpdatesEnabled: () => Promise<boolean>;
};
export const t = initTRPC.context<RouterContext>().create();
export const procedure = t.procedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof TrackerError)
      throw new TRPCError({ code: cause.code, message: cause.message });
    if (cause instanceof Prisma.PrismaClientKnownRequestError) {
      if (cause.code === "P2002")
        throw new TRPCError({
          code: "CONFLICT",
          message: "This record already exists",
        });
      if (cause.code === "P2025")
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (cause.code === "P2003")
        throw new TRPCError({
          code: "CONFLICT",
          message: "The record is still in use",
        });
    }
  }
  return result;
});
export const mutation = procedure
  .input(MutationSchema)
  .use(async ({ ctx, next }) => {
    if (!(await ctx.writesEnabled()))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Tracker writes are paused",
      });
    return next();
  });
