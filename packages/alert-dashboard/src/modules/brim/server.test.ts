import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { mountModules } from "#server/platform/module";

import { createBrimServerModule } from "./server.ts";

function fixture(
  status: 403 | null = null,
  upstreamBody = Response.json({ ok: true }),
) {
  const forward = vi.fn(() => Promise.resolve(upstreamBody));
  const app = new Hono();
  mountModules(app, [
    createBrimServerModule({
      origin: "http://brim.fixture",
      token: "hub-service-credential",
      authorize: () =>
        Promise.resolve(
          status === null
            ? null
            : {
                status,
                error: "operator identity is not authorized",
              },
        ),
      fetch: Object.assign(forward, {
        preconnect: globalThis.fetch.preconnect,
      }),
    }),
  ]);
  return { app, forward };
}

describe("Brim private Hub proxy", () => {
  it("forwards authorized reads with the Hub credential and disables caching", async () => {
    const { app, forward } = fixture();
    const response = await app.request("/api/brim/v1/history/search?q=archive");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(forward).toHaveBeenCalledWith(
      new URL("http://brim.fixture/v1/history/search?q=archive"),
      expect.objectContaining({
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: "Bearer hub-service-credential",
        },
      }),
    );
  });

  it("requires operator authorization before reading a captured request", async () => {
    const { app, forward } = fixture(403);
    const response = await app.request("/api/brim/v1/history/captures/5", {
      headers: { "tailscale-user-login": "pretend-operator@example.com" },
    });
    expect(response.status).toBe(403);
    expect(forward).not.toHaveBeenCalled();
  });

  it("keeps publishers and mutations out of the browser proxy", async () => {
    const { app, forward } = fixture();
    const publication = await app.request("/api/brim/v1/publish/macbook");
    const write = await app.request("/api/brim/v1/priorities", {
      method: "PUT",
    });
    expect(publication.status).toBe(404);
    expect(write.status).toBe(404);
    expect(forward).not.toHaveBeenCalled();
  });

  it("does not serve unexpected upstream content as active HTML", async () => {
    const { app } = fixture(
      null,
      new Response("<script>window.bad = true;</script>", {
        headers: { "content-type": "text/html" },
      }),
    );
    const response = await app.request("/api/brim/v1/history/captures/5");
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Brim is currently unavailable",
    });
  });
});
