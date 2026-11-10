import type { AnyRouter } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono, type Context } from "hono";

/**
 * The server half of a module. Everything a module serves lives under
 * `/api/<id>`, so a module can never shadow the core routes or another
 * module, and its readiness is reported separately at `/readyz/<id>`.
 */
export type ServerModule = {
  /** Stable kebab-case identity, shared with the module's client half. */
  readonly id: string;
  /** Add the module's REST routes to an app mounted at `/api/<id>`. */
  readonly register: (app: Hono) => void;
  /** Served at `/api/<id>/trpc`. */
  readonly trpc?: {
    readonly router: AnyRouter;
    readonly createContext: (request: Request) => object;
  };
  /** Backs `/readyz/<id>`. A module without it is always ready. */
  readonly ready?: () => Promise<boolean>;
  /** Releases the module's resources on shutdown. */
  readonly close?: () => Promise<void>;
};

const MODULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Ids no module may take: `core` is the built-in Ops and alert-ledger module,
 * whose REST API already owns `/api/v1`.
 */
const RESERVED_IDS: ReadonlySet<string> = new Set(["core", "v1"]);

function validate(modules: readonly ServerModule[]): void {
  const seen = new Set<string>();
  for (const module of modules) {
    if (!MODULE_ID.test(module.id))
      throw new Error(`Module id "${module.id}" is not kebab-case`);
    if (RESERVED_IDS.has(module.id))
      throw new Error(`Module id "${module.id}" is reserved`);
    if (seen.has(module.id))
      throw new Error(`Duplicate module id "${module.id}"`);
    seen.add(module.id);
  }
}

function trpcHandler(
  module: ServerModule,
  trpc: NonNullable<ServerModule["trpc"]>,
): (context: Context) => Promise<Response> {
  return (context) =>
    fetchRequestHandler({
      endpoint: `/api/${module.id}/trpc`,
      req: context.req.raw,
      router: trpc.router,
      createContext: ({ req }) => trpc.createContext(req),
      onError: ({ error }) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "trpc_error",
            module: module.id,
            error: error.message,
          }),
        );
      },
    });
}

/**
 * Mount every module under `/api/<id>` and report each at `/readyz/<id>`.
 * Call it before the app's `/api/*` catch-all so an unmatched module path
 * still falls through to the shared JSON 404.
 */
export function mountModules(
  app: Hono,
  modules: readonly ServerModule[],
): void {
  validate(modules);
  const byId = new Map(modules.map((module) => [module.id, module]));
  app.get("/readyz/:id", async (context) => {
    const module = byId.get(context.req.param("id"));
    if (module === undefined) return context.json({ error: "Not found" }, 404);
    const ready = module.ready === undefined || (await module.ready());
    return ready
      ? context.json({ status: "ok" })
      : context.json({ status: "error" }, 503);
  });
  for (const module of modules) {
    if (module.trpc !== undefined) {
      const handle = trpcHandler(module, module.trpc);
      app.all(`/api/${module.id}/trpc`, handle);
      app.all(`/api/${module.id}/trpc/*`, handle);
    }
    const routes = new Hono();
    module.register(routes);
    app.route(`/api/${module.id}`, routes);
  }
}

/** Close every module, attempting all of them even when one fails. */
export async function closeModules(
  modules: readonly ServerModule[],
): Promise<void> {
  const results = await Promise.allSettled(
    modules.map(async (module) => {
      await module.close?.();
    }),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "Failed to close every module");
}
