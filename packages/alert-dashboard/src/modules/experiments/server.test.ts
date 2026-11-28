import { EXPERIMENTS_OPERATOR_HEADER } from "@shepherdjerred/experiments/contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { mountModules } from "#server/platform/module";
import {
  createExperimentsServerModule,
  type ExperimentsUpstream,
} from "./server.ts";

const ID = "0c08284d-9f01-4c0d-a3b5-e1d9fdafed3d";

function appFor(upstream?: ExperimentsUpstream): Hono {
  const app = new Hono();
  app.get("/readyz", (context) => context.json({ status: "ok" }));
  mountModules(app, [createExperimentsServerModule(upstream)]);
  return app;
}

describe("Hub's Experiments adapter", () => {
  it("forwards just the experiment operation with verified actor attribution", async () => {
    const upstream = vi.fn<NonNullable<ExperimentsUpstream["fetch"]>>(
      async () => Response.json({ revision: 4 }),
    );
    const body = JSON.stringify({
      expectedRevision: 3,
      note: "Observed a reduction",
    });
    const incoming = new Request(`http://hub/api/experiments/${ID}/evidence`, {
      method: "POST",
      headers: {
        authorization: "Bearer supplied-by-browser",
        cookie: "browser-session",
        [EXPERIMENTS_OPERATOR_HEADER]: "spoofed-operator",
        "content-type": "application/json",
      },
      body,
    });
    const app = appFor({
      origin: "http://experiments:7408",
      token: "service-token",
      verifyOperator: async (request) =>
        request === incoming
          ? { login: "real-operator" }
          : { status: 401, error: "Unknown request peer" },
      fetch: upstream,
    });
    const response = await app.request(incoming);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const request = upstream.mock.calls[0];
    expect(request?.[0].toString()).toBe(
      `http://experiments:7408/api/v1/experiments/${ID}/evidence`,
    );
    expect(request?.[1]).toMatchObject({
      method: "POST",
      body,
      redirect: "manual",
    });
    const forwarded = new Headers(request?.[1].headers);
    expect(forwarded.get("authorization")).toBe("Bearer service-token");
    expect(forwarded.get(EXPERIMENTS_OPERATOR_HEADER)).toBe("real-operator");
    expect(forwarded.has("cookie")).toBe(false);
  });

  it("rejects denied and undeclared operations before fetching upstream", async () => {
    const upstream = vi.fn<NonNullable<ExperimentsUpstream["fetch"]>>();
    const app = appFor({
      origin: "http://experiments:7408",
      token: "service-token",
      verifyOperator: async () => ({ status: 403, error: "Forbidden" }),
      fetch: upstream,
    });
    const forbidden = await app.request("/api/experiments");
    const undeclared = await app.request(`/api/experiments/${ID}/delete`, {
      method: "POST",
    });
    const invalid = await app.request("/api/experiments/invalid");
    expect(forbidden.status).toBe(403);
    expect(undeclared.status).toBe(404);
    expect(invalid.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("isolates upstream failure from core Hub readiness", async () => {
    const app = appFor({
      origin: "http://experiments:7408",
      token: "service-token",
      verifyOperator: async () => ({ login: "real-operator" }),
      fetch: async () => {
        throw new Error("upstream down");
      },
    });
    const collection = await app.request("/api/experiments?view=due");
    const moduleReadiness = await app.request("/readyz/experiments");
    const coreReadiness = await app.request("/readyz");
    expect(collection.status).toBe(503);
    expect(moduleReadiness.status).toBe(503);
    expect(coreReadiness.status).toBe(200);
  });
});
