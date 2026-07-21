import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import type { DocumentStore } from "#server/document-store";
import { appRouter } from "#server/trpc";

export function createApp(store: DocumentStore): Hono {
  const app = new Hono();

  app.all("/trpc/*", (context) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: context.req.raw,
      router: appRouter,
      createContext: () => ({ store }),
      onError: ({ error }) => {
        console.error(error);
      },
    }),
  );

  app.use("/assets/*", serveStatic({ root: "./dist/client" }));
  app.get("/", serveStatic({ path: "./dist/client/index.html" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
  app.notFound((context) => context.json({ error: "Not found" }, 404));

  return app;
}
