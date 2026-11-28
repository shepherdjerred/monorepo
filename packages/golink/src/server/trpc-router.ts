import {
  createConsoleTRPC,
  type ConsoleIdentity,
  type ConsoleTRPCContext,
} from "@shepherdjerred/console-server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  LinkItemSchema,
  LinksDirectoryResponseSchema,
  ShortSlugSchema,
  UpsertManualLinkInputSchema,
  type Viewer,
} from "#shared/contract.ts";
import { LinksError, type LinksService } from "./links-service.ts";

export type GolinkContext = ConsoleTRPCContext & {
  readonly links: LinksService;
};

const { router, publicProcedure } = createConsoleTRPC<GolinkContext>();

/** Tailscale identity as the directory shows it; anyone else is anonymous. */
export function viewerOf(identity: ConsoleIdentity): Viewer {
  return identity.kind === "viewer"
    ? { login: identity.login, displayName: identity.displayName }
    : { login: null, displayName: null };
}

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LinksError) {
      throw new TRPCError({
        code:
          error.kind === "writes-disabled"
            ? "FORBIDDEN"
            : "INTERNAL_SERVER_ERROR",
        message: error.message,
        cause: error,
      });
    }
    throw error;
  }
}

export const golinkRouter = router({
  links: router({
    /** The directory: every link, the shortcuts, flags and the viewer. */
    list: publicProcedure
      .output(LinksDirectoryResponseSchema)
      .query(async ({ ctx }) => ctx.links.directory(viewerOf(ctx.identity))),
    /** Create or replace a manual link (gated by `golink-writes-enabled`). */
    upsert: publicProcedure
      .input(UpsertManualLinkInputSchema)
      .output(LinkItemSchema)
      .mutation(async ({ ctx, input }) =>
        translate(async () => ctx.links.upsert(input, viewerOf(ctx.identity))),
      ),
    /** Delete a manual link (gated by `golink-writes-enabled`). */
    delete: publicProcedure
      .input(z.object({ short: ShortSlugSchema }))
      .output(z.object({ deleted: z.literal(true) }))
      .mutation(async ({ ctx, input }) =>
        translate(async () => ctx.links.remove(input.short)),
      ),
  }),
});

export type GolinkRouter = typeof golinkRouter;
