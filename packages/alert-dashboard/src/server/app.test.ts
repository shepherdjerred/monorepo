import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { initTRPC } from "@trpc/server";
import { z } from "zod";

import { AlertService } from "#application/alert-service";
import type {
  AlertmanagerPort,
  PostalPort,
  PreviewPort,
} from "#application/ports";
import { createApp } from "#server/app";
import { ChangeBus } from "#server/change-bus";
import { Metrics } from "#server/metrics";
import { closeModules, type ServerModule } from "#server/platform/module";
import { readinessOnlyLedger, unexpected } from "#test-fixtures/alert-ledger";
import { createOpsFixture } from "#test-fixtures/ops-services";

const ErrorResponseSchema = z.object({ error: z.string() });

function createTestService(): AlertService {
  const repository = readinessOnlyLedger();
  const alertmanager: AlertmanagerPort = { activeAlerts: unexpected };
  const postal: PostalPort = { send: unexpected };
  const previews: PreviewPort = {
    previews: unexpected,
    health: unexpected,
  };
  return new AlertService({
    repository,
    alertmanager,
    postal,
    previews,
    clock: {
      now: () => Temporal.Instant.from("2026-08-08T12:00:00Z"),
    },
    emailEnabled: false,
  });
}

function opsOptions() {
  const fixture = createOpsFixture({
    now: () => Temporal.Instant.from("2026-08-08T12:00:00Z"),
  });
  return {
    ops: fixture.ops,
    digests: fixture.digests,
    opsIngestToken: "test-ops-ingest-token",
  };
}

describe("REST request validation", () => {
  it("checks only database readiness on the readiness route", async () => {
    const app = createApp({
      service: createTestService(),
      changes: new ChangeBus(),
      metrics: new Metrics(),
      webhookToken: "test-webhook-token",
      ...opsOptions(),
    });

    const response = await app.request("/readyz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 400 for malformed label filters", async () => {
    const app = createApp({
      service: createTestService(),
      changes: new ChangeBus(),
      metrics: new Metrics(),
      webhookToken: "test-webhook-token",
      ...opsOptions(),
    });

    const response = await app.request("/api/v1/alerts?label=severity");

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error).toBe(
      "Invalid request",
    );
  });

  it("returns 400 for malformed webhook JSON", async () => {
    const app = createApp({
      service: createTestService(),
      changes: new ChangeBus(),
      metrics: new Metrics(),
      webhookToken: "test-webhook-token",
      ...opsOptions(),
    });

    const response = await app.request("/internal/v1/alertmanager/events", {
      method: "POST",
      headers: { Authorization: "Bearer test-webhook-token" },
      body: "{not-json",
    });

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error).toBe(
      "Invalid request",
    );
  });

  it.each(["/api/v2/summary", "/internal/v2/alertmanager/events"])(
    "returns a JSON 404 for unsupported API path %s",
    async (path) => {
      const app = createApp({
        service: createTestService(),
        changes: new ChangeBus(),
        metrics: new Metrics(),
        webhookToken: "test-webhook-token",
        ...opsOptions(),
      });

      const response = await app.request(path);

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(ErrorResponseSchema.parse(await response.json()).error).toBe(
        "Not found",
      );
    },
  );

  it("returns a JSON 404 for an unsupported tRPC procedure", async () => {
    const app = createApp({
      service: createTestService(),
      changes: new ChangeBus(),
      metrics: new Metrics(),
      webhookToken: "test-webhook-token",
      ...opsOptions(),
    });

    const response = await app.request("/trpc/not.real");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

function registerNothing(): void {
  // A module with no REST routes.
}

function appWith(modules: readonly ServerModule[]) {
  return createApp({
    service: createTestService(),
    changes: new ChangeBus(),
    metrics: new Metrics(),
    webhookToken: "test-webhook-token",
    ...opsOptions(),
    modules,
  });
}

describe("module mounting", () => {
  const t = initTRPC.create();
  function notesModule(ready: boolean): ServerModule {
    return {
      id: "notes",
      register: (routes) => {
        routes.get("/entries/:id", (context) =>
          context.json({ id: context.req.param("id") }),
        );
        routes.get("/invalid", () => {
          z.string().parse(1);
          return new Response();
        });
      },
      trpc: {
        router: t.router({ ping: t.procedure.query(() => "pong") }),
        createContext: () => ({}),
      },
      ready: () => Promise.resolve(ready),
    };
  }

  it("serves a module's REST routes under /api/<id>", async () => {
    const response = await appWith([notesModule(true)]).request(
      "/api/notes/entries/42",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "42" });
  });

  it("serves a module's tRPC router at /api/<id>/trpc", async () => {
    const response = await appWith([notesModule(true)]).request(
      "/api/notes/trpc/ping",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: "pong" } });
  });

  it("falls through to the shared JSON 404 for an unmatched module path", async () => {
    const response = await appWith([notesModule(true)]).request(
      "/api/notes/missing",
    );

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).error).toBe(
      "Not found",
    );
  });

  it("applies the shared error handling to module routes", async () => {
    const response = await appWith([notesModule(true)]).request(
      "/api/notes/invalid",
    );

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error).toBe(
      "Invalid request",
    );
  });

  it("reports each module at /readyz/<id> and keeps /readyz core-only", async () => {
    const app = appWith([notesModule(false)]);

    const core = await app.request("/readyz");
    const module = await app.request("/readyz/notes");
    const unknown = await app.request("/readyz/absent");

    expect(core.status).toBe(200);
    expect(module.status).toBe(503);
    expect(await module.json()).toEqual({ status: "error" });
    expect(unknown.status).toBe(404);
  });

  it("treats a module without a readiness check as ready", async () => {
    const response = await appWith([
      { id: "plain", register: registerNothing },
    ]).request("/readyz/plain");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("leaves every core route in place when modules are mounted", async () => {
    const app = appWith([notesModule(true)]);

    for (const path of ["/healthz", "/readyz", "/api/v1/ops/changes"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
    }
  });

  it.each(["core", "v1", "Notes"])("rejects the module id %s", (id) => {
    expect(() => appWith([{ id, register: registerNothing }])).toThrow(
      `Module id "${id}"`,
    );
  });

  it("rejects duplicate module ids", () => {
    expect(() => appWith([notesModule(true), notesModule(true)])).toThrow(
      'Duplicate module id "notes"',
    );
  });
});

describe("module shutdown", () => {
  it("closes every module even when one fails", async () => {
    const closed: string[] = [];
    const modules: ServerModule[] = [
      {
        id: "first",
        register: registerNothing,
        close: () => Promise.reject(new Error("first failed")),
      },
      {
        id: "second",
        register: registerNothing,
        close: () => {
          closed.push("second");
          return Promise.resolve();
        },
      },
      { id: "third", register: registerNothing },
    ];

    await expect(closeModules(modules)).rejects.toThrow(
      "Failed to close every module",
    );
    expect(closed).toEqual(["second"]);
  });
});
