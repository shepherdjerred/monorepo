import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import type { EvalStore } from "#server/store.ts";
import { appRouter } from "#server/trpc.ts";

export function createApp(store: EvalStore): Hono {
  const app = new Hono();

  app.get("/health", (context) => context.json({ status: "ok" }));
  app.all("/trpc/*", (context) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: context.req.raw,
      router: appRouter,
      createContext: () => ({ store }),
    }),
  );

  app.use("/assets/*", serveStatic({ root: "./dist/client" }));
  app.get("/", serveStatic({ path: "./dist/client/index.html" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
  return app;
}
