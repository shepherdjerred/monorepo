import type { Context, Hono } from "hono";
import type { FacetStore } from "./types.ts";

export function mountAttachmentRoute(
  app: Hono,
  store: FacetStore,
  getUserId: (c: Context) => string,
): void {
  app.get("/api/v1/tasks/:taskId/comments/:commentId/file", async (c) => {
    const bytes = await store.getAttachment(
      c.req.param("taskId"),
      c.req.param("commentId"),
      getUserId(c),
    );
    if (bytes === null) return c.notFound();
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
