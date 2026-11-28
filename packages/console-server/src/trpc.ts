import {
  initTRPC,
  TRPCError,
  type AnyTRPCRouter,
  type inferRouterContext,
} from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { identityOf, requestIdOf, type ConsoleEnv } from "./context.ts";
import {
  IdentityRejectedError,
  type ConsoleIdentity,
  type ConsoleMachine,
  type ConsoleViewer,
} from "./identity.ts";

/** What every console's tRPC context starts with. */
export type ConsoleTRPCContext = {
  readonly identity: ConsoleIdentity;
  readonly requestId: string;
};

/** What the server hands an app's `createContext`. */
export type ConsoleContextInput = ConsoleTRPCContext & {
  readonly request: Request;
  readonly c: Context<ConsoleEnv>;
};

const REJECTION_CODES = {
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  503: "SERVICE_UNAVAILABLE",
} as const;

/**
 * Builds a console's tRPC root: no transformer (plain JSON, as Hub and Tracker
 * use), Zod issues surfaced under `data.zodError`, SSE subscriptions with a
 * keep-alive ping, and the three procedure kinds every console needs.
 */
export function createConsoleTRPC<TContext extends ConsoleTRPCContext>() {
  const t = initTRPC.context<TContext>().create({
    errorFormatter: ({ shape, error }) => ({
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof z.ZodError
            ? z.flattenError(error.cause)
            : null,
      },
    }),
    sse: {
      // Tailscale serve and Bun's 60s idle timeout both close a quiet stream.
      ping: { enabled: true, intervalMs: 15_000 },
      client: { reconnectAfterInactivityMs: 30_000 },
    },
  });

  const publicProcedure = t.procedure;

  /** A tailnet person, named by the trusted Tailscale proxy. */
  const viewerProcedure = t.procedure.use(async ({ ctx, next }) => {
    if (ctx.identity.kind !== "viewer") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tailscale identity required",
      });
    }
    const viewer: ConsoleViewer = ctx.identity;
    return next({ ctx: { viewer } });
  });

  /** A first-party caller whose token carries `scope`. */
  const machineProcedure = (scope: string) =>
    t.procedure.use(async ({ ctx, next }) => {
      if (ctx.identity.kind !== "machine") {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Machine credential required",
        });
      }
      if (!ctx.identity.scopes.includes(scope)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Credential lacks ${scope} permission`,
        });
      }
      const machine: ConsoleMachine = ctx.identity;
      return next({ ctx: { machine } });
    });

  return {
    t,
    router: t.router,
    middleware: t.middleware,
    publicProcedure,
    viewerProcedure,
    machineProcedure,
  };
}

export type ConsoleTRPCOptions<TRouter extends AnyTRPCRouter> = {
  readonly router: TRouter;
  /** Adds the app's dependencies to the identity and request id. */
  readonly createContext: (
    input: ConsoleContextInput,
  ) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;
  /** @default "/trpc" */
  readonly endpoint?: string;
};

export type MountTRPCOptions<TRouter extends AnyTRPCRouter> =
  ConsoleTRPCOptions<TRouter> & {
    readonly service: string;
    /** Ends live subscriptions when the server stops. */
    readonly shutdown: AbortSignal;
    readonly onError: (error: unknown) => void;
  };

async function contextIdentity(
  c: Context<ConsoleEnv>,
): Promise<ConsoleIdentity> {
  try {
    return await identityOf(c);
  } catch (error) {
    if (error instanceof IdentityRejectedError) {
      throw new TRPCError({
        code: REJECTION_CODES[error.status],
        message: error.message,
      });
    }
    throw error;
  }
}

/** Mounts tRPC's fetch adapter at `endpoint` and `endpoint/*`. */
export function mountTRPC<TRouter extends AnyTRPCRouter>(
  app: Hono<ConsoleEnv>,
  options: MountTRPCOptions<TRouter>,
): void {
  const endpoint = options.endpoint ?? "/trpc";
  const handle = async (c: Context<ConsoleEnv>) => {
    // A subscription is a long-lived request; tie it to shutdown so the
    // server can drain.
    const request = new Request(c.req.raw, {
      signal: AbortSignal.any([c.req.raw.signal, options.shutdown]),
    });
    return fetchRequestHandler({
      endpoint,
      req: request,
      router: options.router,
      createContext: async () => {
        const identity = await contextIdentity(c);
        return options.createContext({
          identity,
          requestId: requestIdOf(c),
          request,
          c,
        });
      },
      onError: ({ error, path, type }) => {
        console.warn(
          JSON.stringify({
            level: error.code === "INTERNAL_SERVER_ERROR" ? "error" : "warn",
            message: "trpc_error",
            service: options.service,
            requestId: requestIdOf(c),
            path,
            type,
            code: error.code,
            error: error.message,
          }),
        );
        if (error.code === "INTERNAL_SERVER_ERROR") {
          options.onError(error.cause ?? error);
        }
      },
    });
  };
  app.all(endpoint, handle);
  app.all(`${endpoint}/*`, handle);
}
