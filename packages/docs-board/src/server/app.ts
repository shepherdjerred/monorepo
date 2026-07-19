import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { DocumentStore } from "#server/document-store";
import {
  DocumentConflictError,
  DocumentNotFoundError,
  DocumentWorkflowError,
} from "#server/document-store";
import {
  CommentRequestSchema,
  RevisionRequestSchema,
  StatusUpdateRequestSchema,
} from "#shared/schema";

const IdSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) });

export function createApp(store: DocumentStore): Hono {
  const app = new Hono();

  app.get("/api/documents", async (context) =>
    context.json(await store.list()),
  );
  app.get(
    "/api/documents/:id",
    zValidator("param", IdSchema),
    async (context) => {
      const { id } = context.req.valid("param");
      return context.json(await store.get(id));
    },
  );
  app.patch(
    "/api/documents/:id/status",
    zValidator("param", IdSchema),
    zValidator("json", StatusUpdateRequestSchema),
    async (context) => {
      const { id } = context.req.valid("param");
      const request = context.req.valid("json");
      return context.json(await store.updateStatus(id, request));
    },
  );
  app.post(
    "/api/documents/:id/comments",
    zValidator("param", IdSchema),
    zValidator("json", CommentRequestSchema),
    async (context) => {
      const { id } = context.req.valid("param");
      const request = context.req.valid("json");
      return context.json(
        await store.addComment(
          id,
          request.revision,
          request.actor,
          request.comment,
        ),
      );
    },
  );
  app.post(
    "/api/documents/:id/archive",
    zValidator("param", IdSchema),
    zValidator("json", RevisionRequestSchema),
    async (context) => {
      const { id } = context.req.valid("param");
      const request = context.req.valid("json");
      return context.json(
        await store.archive(id, request.revision, request.actor),
      );
    },
  );
  app.get("/api/events", (context) =>
    streamSSE(context, async (stream) => {
      await stream.writeSSE({ event: "ready", data: "connected" });
      await new Promise<void>((resolve) => {
        const publish = async (): Promise<void> => {
          try {
            await stream.writeSSE({
              event: "documents",
              data: new Date().toISOString(),
            });
          } catch (error) {
            console.error("failed to publish docs update", error);
          }
        };
        const unsubscribe = store.subscribe(() => {
          void publish();
        });
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    }),
  );

  app.onError((error, context) => {
    if (error instanceof DocumentNotFoundError) {
      return context.json({ error: "Document not found" }, 404);
    }
    if (error instanceof DocumentConflictError) {
      return context.json({ error: error.message }, 409);
    }
    if (error instanceof DocumentWorkflowError) {
      return context.json({ error: error.message }, 422);
    }
    console.error(error);
    return context.json({ error: "Internal server error" }, 500);
  });

  app.use("/assets/*", serveStatic({ root: "./dist/client" }));
  app.get("/", serveStatic({ path: "./dist/client/index.html" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
  app.notFound((context) => context.json({ error: "Not found" }, 404));

  return app;
}
