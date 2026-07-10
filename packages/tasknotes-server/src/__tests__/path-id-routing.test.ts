import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

/**
 * P3 spike, pinned: the v2 contract uses vault-relative paths as task IDs
 * (upstream plugin semantics). This proves Hono's `:id` param carries a
 * URL-encoded path — including encoded slashes, spaces, and unicode — and
 * decodes it, even with a static segment after the param. Clients MUST
 * encodeURIComponent the id (the app's PATHS helpers already do); a literal
 * unencoded slash is a 404 by design.
 */

function makeApp(): Hono {
  const app = new Hono();
  app.get("/api/tasks/:id", (c) => c.json({ id: c.req.param("id") }));
  app.get("/api/tasks/:id/time", (c) =>
    c.json({ id: c.req.param("id"), sub: "time" }),
  );
  return app;
}

describe("path-as-ID routing through Hono :id params", () => {
  test("an encoded slash reaches the handler decoded", async () => {
    const res = await makeApp().request(
      "/api/tasks/TaskNotes%2Fwater-plants.md",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "TaskNotes/water-plants.md" });
  });

  test("works with a static segment after the param", async () => {
    const res = await makeApp().request(
      "/api/tasks/TaskNotes%2Fwater-plants.md/time",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "TaskNotes/water-plants.md",
      sub: "time",
    });
  });

  test("spaces and unicode in filenames survive the round trip", async () => {
    const res = await makeApp().request(
      "/api/tasks/TaskNotes%2FBuy%20milk%20%E2%98%95.md",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "TaskNotes/Buy milk ☕.md" });
  });

  test("a literal unencoded slash does not match (clients must encode)", async () => {
    const res = await makeApp().request("/api/tasks/TaskNotes/water-plants.md");
    expect(res.status).toBe(404);
  });
});
