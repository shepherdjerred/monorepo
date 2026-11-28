import { initTRPC, TRPCError } from "@trpc/server";
import { Prisma } from "#generated/prisma/client.ts";
import { ArtifactsError, type ErrorCode } from "#application/errors.ts";
import type { Services } from "#application/services.ts";
import type { Caller } from "#application/types.ts";

/** Which listener served the request; `maintenance.*` is internal only. */
export type HostClass = "app" | "internal";

export type RouterContext = {
  requestId: string;
  hostClass: HostClass;
  /** Null on the internal host and for a request that named no actor. */
  caller: Caller | null;
  services: Services;
};

export const t = initTRPC.context<RouterContext>().create({
  errorFormatter: ({ shape, error }) => {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        ...(cause instanceof ArtifactsError && "conflict" in cause.data
          ? { conflict: cause.data["conflict"] }
          : {}),
      },
    };
  },
});

const TRPC_CODE: Record<ErrorCode, TRPCError["code"]> = {
  BAD_REQUEST: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNPROCESSABLE_CONTENT: "UNPROCESSABLE_CONTENT",
  GONE: "NOT_FOUND",
};

/** Maps expected failures to typed tRPC errors; unexpected ones stay 500. */
const mapErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof ArtifactsError)
      throw new TRPCError({
        code: TRPC_CODE[cause.code],
        message: cause.message,
        cause,
      });
    if (
      cause instanceof Prisma.PrismaClientKnownRequestError &&
      cause.code === "P2025"
    )
      throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
  }
  return result;
});

/** Procedures of the app host: a verified caller, never the internal host. */
export const procedure = t.procedure.use(mapErrors).use(({ ctx, next }) => {
  if (ctx.hostClass !== "app" || ctx.caller === null)
    throw new TRPCError({ code: "NOT_FOUND" });
  return next({ ctx: { ...ctx, caller: ctx.caller } });
});

/** App mutations are refused while the `artifacts-enabled` flag is off. */
export const mutation = procedure.use(async ({ ctx, next }) => {
  if (!(await ctx.services.deps.settings.value("artifactsEnabled")))
    throw new TRPCError({ code: "FORBIDDEN", message: "Artifacts is paused" });
  return next();
});

/** Procedures reachable on the internal host only. */
export const internalProcedure = t.procedure
  .use(mapErrors)
  .use(({ ctx, next }) => {
    if (ctx.hostClass !== "internal")
      throw new TRPCError({ code: "NOT_FOUND" });
    return next();
  });
