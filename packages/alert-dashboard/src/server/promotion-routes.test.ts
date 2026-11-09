import { afterEach, expect, it } from "vitest";
import { Hono } from "hono";
import { registerPromotionRoutes } from "./promotion-routes.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
});

it("forwards only read-only promotion routes with the parent credential", async () => {
  const requests: { path: string; auth: string | null }[] = [];
  const upstream = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      requests.push({
        path: url.pathname + url.search,
        auth: request.headers.get("authorization"),
      });
      return Response.json({ ok: true });
    },
  });
  servers.push(upstream);
  const app = new Hono();
  registerPromotionRoutes(app, upstream.url.href, "fixture-token");
  const read = await app.request(
    "/api/v1/promotion/history?targetId=pmc&limit=10",
  );
  expect(read.status).toBe(200);
  expect(requests).toEqual([
    {
      path: "/api/v1/promotion/history?targetId=pmc&limit=10",
      auth: "Bearer fixture-token",
    },
  ]);
  const mutation = await app.request("/api/v1/promotion", { method: "POST" });
  expect(mutation.status).toBe(405);
  expect(await app.request("/api/v1/promotion/other")).toHaveProperty(
    "status",
    404,
  );
  expect(requests).toHaveLength(1);
});

it("shows unavailable status when the producer has not been configured", async () => {
  const app = new Hono();
  registerPromotionRoutes(app, undefined, "fixture-token");
  const response = await app.request("/api/v1/promotion");
  expect(response.status).toBe(503);
});
