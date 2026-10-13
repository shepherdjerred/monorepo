import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { appRouter, type RouterContext } from "./router.ts";
import type { Attachments } from "#infrastructure/attachments.ts";
import { TrackerError } from "#domain/error.ts";
import { ActorSchema } from "#shared/actor.ts";
import { avatarSvg } from "#shared/avatar.ts";
import { traceRequest, reportError } from "#infrastructure/observability.ts";

type AppOptions = Omit<RouterContext, "requestId"> & {
  attachments: Attachments;
  attachmentMaxBytes: () => Promise<number>;
};
const clientRoot = `${import.meta.dir}/../../dist/client`;

export function createApp(options: AppOptions) {
  const app = new Hono();
  const requests = new Map<string, number>();
  app.use(secureHeaders());
  app.use(async (context, next) => {
    const requestId = crypto.randomUUID();
    context.header("x-request-id", requestId);
    await traceRequest(
      context.req.raw,
      context.req.path.startsWith("/trpc") ? "trpc" : "http",
      next,
    );
    const route = context.req.path.startsWith("/trpc")
      ? "trpc"
      : context.req.path.startsWith("/attachments/")
        ? "attachment"
        : context.req.path === "/api/attachments"
          ? "upload"
          : "other";
    const key = `route="${route}",status="${String(context.res.status)}"`;
    requests.set(key, (requests.get(key) ?? 0) + 1);
  });
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    try {
      await options.issues.database.$queryRaw`SELECT 1`;
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });
  app.get("/metrics", async (c) => {
    const [issues, actors] = await Promise.all([
      options.issues.database.issue.groupBy({
        by: ["teamId", "stateId"],
        _count: true,
      }),
      options.issues.database.actor.groupBy({ by: ["kind"], _count: true }),
    ]);
    const [teams, states] = await Promise.all([
      options.issues.database.team.findMany(),
      options.issues.database.workflowState.findMany(),
    ]);
    const totals = new Map<string, number>();
    for (const row of issues) {
      const team = teams.find(({ id }) => id === row.teamId);
      const state = states.find(({ id }) => id === row.stateId);
      if (team === undefined || state === undefined)
        throw new Error("Issue references missing catalog data");
      const key = `team="${team.key}",state_type="${state.type}"`;
      totals.set(key, (totals.get(key) ?? 0) + row._count);
    }
    return c.text(
      [
        "# TYPE tracker_issues_total gauge",
        ...Array.from(
          totals,
          ([key, count]) => `tracker_issues_total{${key}} ${String(count)}`,
        ),
        "# TYPE tracker_actors_total gauge",
        ...actors.map(
          (row) =>
            `tracker_actors_total{kind="${row.kind}"} ${String(row._count)}`,
        ),
        "# TYPE tracker_requests_total counter",
        ...Array.from(
          requests,
          ([key, count]) => `tracker_requests_total{${key}} ${String(count)}`,
        ),
        "",
      ].join("\n"),
      200,
      { "Content-Type": "text/plain; version=0.0.4" },
    );
  });
  app.get("/avatars/:filename", (c) => {
    const filename = c.req.param("filename");
    return filename.endsWith(".svg")
      ? c.body(avatarSvg(filename.slice(0, -4)), 200, {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Security-Policy": "default-src 'none'",
        })
      : c.notFound();
  });
  app.get("/attachments/:id/:filename", (c) =>
    options.attachments.download(c.req.param("id"), c.req.param("filename")),
  );
  app.post(
    "/api/attachments",
    bodyLimit({ maxSize: 101 * 1024 * 1024 }),
    async (c) => {
      if (!(await options.writesEnabled()))
        return c.json({ error: "Tracker writes are paused" }, 403);
      const header = c.req.header("X-Tracker-Actor");
      if (header === undefined || header.length > 16_000)
        return c.json({ error: "An actor is required" }, 400);
      let envelope: unknown;
      try {
        envelope = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      } catch {
        return c.json({ error: "Invalid actor envelope" }, 400);
      }
      const actor = ActorSchema.parse(envelope);
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        return c.json({ error: "One file is required" }, 400);
      const max = await options.attachmentMaxBytes();
      return file.size > max
        ? c.json({ error: "Attachment exceeds the size limit" }, 413)
        : c.json(
            await options.attachments.upload(
              file,
              actor,
              max,
              c.res.headers.get("x-request-id") ?? crypto.randomUUID(),
            ),
            201,
          );
    },
  );
  app.all("/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      onError: ({ error }) => {
        if (error.code === "INTERNAL_SERVER_ERROR") reportError(error.cause);
      },
      createContext: () => ({
        ...options,
        requestId: c.res.headers.get("x-request-id") ?? crypto.randomUUID(),
      }),
    }),
  );
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.use("/assets/*", serveStatic({ root: clientRoot }));
  app.get("*", serveStatic({ root: clientRoot, path: "index.html" }));
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        { error: "Invalid request", details: z.treeifyError(error) },
        400,
      );
    if (error instanceof TrackerError)
      return c.json(
        { error: error.message },
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONFLICT"
            ? 409
            : error.code === "FORBIDDEN"
              ? 403
              : 400,
      );
    console.error(
      JSON.stringify({ message: "request_failed", error: error.message }),
    );
    reportError(error);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}
