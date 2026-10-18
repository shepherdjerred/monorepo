import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testExecutor, testOperator } from "#testing/seed.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createApp } from "./app.ts";

describe("Delivery API authorization and kill switch", () => {
  let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
  let delivery: Delivery;
  let fixture: Awaited<ReturnType<typeof seedDelivery>>;
  let writes = true;
  let enabled: string[] = ["arcade/prod"];
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    cluster = await createTestDatabase();
    delivery = new Delivery(cluster.database);
    fixture = await seedDelivery(delivery);
    app = createApp({
      delivery,
      ciOrigin: "https://woodpecker.sjer.red",
      ciRepositoryId: 1,
      qualifyBuild: async () => "verified",
      peerAddress: () => "127.0.0.1",
      config: {
        publicOrigin: "http://delivery.test",
        machineCredentials: [
          {
            token: "test-executor-credential-32-characters",
            principal: testExecutor,
          },
          {
            token: "test-publisher-credential-32-characters",
            principal: {
              id: "publisher",
              kind: "machine",
              scopes: ["read", "publish"],
            },
          },
        ],
        writesEnabled: async () => writes,
        enabledEnvironments: async () => enabled,
        operatorLogins: async () => ["operator@example.com"],
        trustedProxyAddresses: async () => ["127.0.0.1"],
      },
    });
  }, 60_000);
  afterAll(async () => {
    await cluster.close();
  });
  const human = {
    "Tailscale-User-Login": "operator@example.com",
    Origin: "http://delivery.test",
    "Content-Type": "application/json",
  };
  test("Prometheus can scrape bounded operational gauges without a deployment credential", async () => {
    const response = await app.request("/metrics");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "text/plain; version=0.0.4",
    );
    expect(await response.text()).toContain(
      "# TYPE delivery_outbox_pending gauge",
    );
  });
  test("publisher cannot deploy or execute even when spoofing operator identity", async () => {
    const response = await app.request("/api/v1/deployments", {
      method: "POST",
      headers: {
        ...human,
        Authorization: "Bearer test-publisher-credential-32-characters",
      },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(await cluster.database.deployment.count()).toBe(0);
  });
  test("disabled environment denies a correctly authenticated deployment", async () => {
    enabled = [];
    const response = await app.request("/api/v1/deployments", {
      method: "POST",
      headers: human,
      body: JSON.stringify({
        requestId: "disabled",
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: 0,
      }),
    });
    expect(response.status).toBe(503);
    enabled = [fixture.environment.id];
  });
  test("paused mutations deny new requests but permit canceling owned work", async () => {
    const deployment = await delivery.createDeployment(
      {
        requestId: "cancelable",
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    writes = false;
    const denied = await app.request("/api/v1/deployments", {
      method: "POST",
      headers: human,
      body: "{}",
    });
    expect(denied.status).toBe(503);
    const canceled = await app.request(
      `/api/v1/deployments/${deployment.id}/cancel`,
      { method: "POST", headers: human, body: "{}" },
    );
    expect(canceled.status).toBe(200);
    const detail = await delivery.detail(deployment.id);
    expect(detail.deployment.status).toBe("canceled");
    writes = true;
  });
  test("readiness queries actual PostgreSQL and anonymous API calls fail", async () => {
    const ready = await app.request("/readyz");
    const anonymous = await app.request("/api/v1/overview");
    const overview = await app.request("/api/v1/overview", { headers: human });
    expect(ready.status).toBe(200);
    expect(anonymous.status).toBe(403);
    expect(overview.status).toBe(200);
    expect(testExecutor.scopes).toContain("execute");
  });
  test("paused dispatch can inspect and acknowledge a lost Workflow start response without admitting new work", async () => {
    const deployment = await delivery.createDeployment(
      {
        requestId: "lost-start-receipt",
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    writes = false;
    const headers = {
      Authorization: "Bearer test-executor-credential-32-characters",
      "Content-Type": "application/json",
    };
    const monitored = await app.request("/api/v1/dispatch/monitor", {
      headers,
    });
    expect(monitored.status).toBe(200);
    const snapshot: unknown = await monitored.json();
    expect(snapshot).toMatchObject({
      deployments: [
        {
          id: deployment.id,
          submitted: false,
          workflowId: `delivery/${deployment.id}`,
        },
      ],
    });
    const mismatch = await app.request(
      `/api/v1/dispatch/${deployment.id}/submitted`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ workflowId: "wrong-workflow" }),
      },
    );
    expect(mismatch.status).toBe(400);
    const acknowledged = await app.request(
      `/api/v1/dispatch/${deployment.id}/submitted`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ workflowId: `delivery/${deployment.id}` }),
      },
    );
    expect(acknowledged.status).toBe(200);
    const monitoredAgain = await delivery.monitor();
    expect(monitoredAgain.deployments[0]).toMatchObject({
      id: deployment.id,
      submitted: true,
    });
    const pending = await app.request("/api/v1/dispatch/pending", { headers });
    expect(await pending.json()).toEqual({ deployments: [] });
    await delivery.cancel(deployment.id, testOperator);
    writes = true;
  });
});
