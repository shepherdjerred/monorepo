import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
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
