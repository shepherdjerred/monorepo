import type { Hono } from "hono";
import { requireScope, resolveRequestUserId } from "./request-context.ts";
import type { FacetStore } from "./types.ts";

export function mountAttachmentRoute(app: Hono, store: FacetStore): void {
  app.get("/api/v1/tasks/:taskId/comments/:commentId/file", async (c) => {
    const scopeDenied = requireScope(c, "read");
    if (scopeDenied !== null) {
      return scopeDenied;
    }
    const resolvedUser = resolveRequestUserId(c);
    if (!resolvedUser.ok) {
      return resolvedUser.response;
    }
    const bytes = await store.getAttachment(
      c.req.param("taskId"),
      c.req.param("commentId"),
      resolvedUser.userId,
    );
    if (bytes === null) {
      return c.notFound();
    }
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
