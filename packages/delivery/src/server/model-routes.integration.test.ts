import { beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createDeliveryClient } from "#shared/client.ts";
import type { ColdStartSnapshot } from "#shared/model/cold-start-contract.ts";
import {
  MonitorStatusSchema,
  WatchingMonitorSchema,
} from "#shared/model/monitor-contract.ts";
import {
  ApprovalQueueItemSchema,
  CatalogReconcileResultSchema,
  CatalogStateSchema,
  DeploymentDetailV2Schema,
  DeploymentV2Schema,
  EnvironmentSelectionSchema,
  ReconcileAfterRestoreSchema,
  ServiceLifecycleViewSchema,
} from "#shared/model/route-contract.ts";
import { RecoveryIntentV2Schema } from "#shared/recovery-intent.ts";
import { catalogDocument } from "#testing/catalog-fixture.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { arcadeRegistration, publishCiRunner } from "#testing/model-fixture.ts";
import { fixturePrincipals, testExecutor } from "#testing/seed.ts";
import { createApp } from "./app.ts";

/**
 * The model route table (`docs/model.md`, section 4): each route answers in
 * the shape the shared contract names, so the hub and toolkit can parse it.
 */
const context = useDeliveryFixture({ registration: arcadeRegistration });
const OPERATOR = "operator@example.com";
const principals = fixturePrincipals;
let snapshot: ColdStartSnapshot | undefined;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  snapshot = undefined;
  await publishCiRunner(context.delivery);
  app = createApp({
    delivery: context.delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    peerAddress: () => "127.0.0.1",
    qualifyBuild: async () => "verified",
    readColdStartSnapshot: async () => {
      if (snapshot === undefined) throw new Error("No snapshot stored");
      return snapshot;
    },
    config: {
      publicOrigin: "http://delivery.test",
      writesEnabled: async () => true,
      enabledEnvironments: async () => [],
      operatorLogins: async () => [OPERATOR],
      trustedProxyAddresses: async () => ["127.0.0.1"],
      machineCredentials: Object.entries(principals).map(
        ([token, principal]) => ({ token: `fixture-${token}`, principal }),
      ),
    },
  });
});

type Method = "GET" | "POST";

/** One request as `role`; `human` is the operator behind the private ingress. */
async function call(
  method: Method,
  path: string,
  role: string,
  body?: unknown,
) {
  const headers: Record<string, string> =
    role === "human"
      ? { "tailscale-user-login": OPERATOR, origin: "http://delivery.test" }
      : { Authorization: `Bearer fixture-${role}` };
  const response = await app.request(`http://delivery.test/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed: unknown = await response.json();
  return { status: response.status, json: parsed };
}
async function read(path: string, role = "deployer") {
  const response = await call("GET", path, role);
  return response.json;
}
async function status(path: string, role: string, body: unknown) {
  const response = await call("POST", path, role, body);
  return response.status;
}

const prod = encodeURIComponent("arcade/prod");

async function selection() {
  return EnvironmentSelectionSchema.parse(
    await read(`/environments/${prod}/selection`),
  );
}

async function requestDeploy() {
  const current = await selection();
  const created = await call("POST", "/deployments", "deployer", {
    requestId: crypto.randomUUID(),
    environmentId: "arcade/prod",
    versionSetRevisionId: context.fixture.versionSet.id,
    expectedGeneration: current.bindingGeneration,
    kind: "deploy",
  });
  expect(created.status).toBe(201);
  return DeploymentV2Schema.parse(created.json);
}

async function detail(deploymentId: string) {
  return DeploymentDetailV2Schema.parse(
    await read(`/deployments/${deploymentId}`),
  );
}

describe("selections, deployments and monitors", () => {
  test("a deployment carries the selection it froze; detail and monitor views parse", async () => {
    const declared = await selection();
    expect(declared).toMatchObject({
      accepted: null,
      acceptedDeploymentId: null,
      declared: { recipeKind: "kubernetes-application" },
      lifecycle: "active",
    });
    const deployment = await requestDeploy();
    expect(deployment.selection).toEqual({
      versionSetRevisionId: context.fixture.versionSet.id,
      recipeRevisionId: declared.declared.recipeRevisionId,
      configurationRevisionId: declared.declared.configurationRevisionId,
    });
    expect(await detail(deployment.id)).toMatchObject({
      deployment: { id: deployment.id, previousAcceptedDeploymentId: null },
      approval: null,
      recoveryIntents: [],
    });
    expect(
      MonitorStatusSchema.parse(await read(`/environments/${prod}/monitor`)),
    ).toMatchObject({ state: "unmonitored", monitor: null });
    expect(
      z
        .array(WatchingMonitorSchema)
        .parse(await read("/monitors/watching", "executor")),
    ).toEqual([]);
    expect(
      await status(
        `/deployments/${deployment.id}/monitor/observations`,
        "executor",
        {
          observedAt: new Date().toISOString(),
          window: "5m",
          alarms: [],
          evidence: {},
        },
      ),
    ).toBe(409);
  });

  test("approvals are decided by a human and listed with their record", async () => {
    await context.cluster.database.environment.update({
      where: { id: "arcade/prod" },
      data: { approvalPolicy: "required" },
    });
    const deployment = await requestDeploy();
    expect(deployment.status).toBe("awaiting_approval");
    expect(
      z.array(ApprovalQueueItemSchema).parse(await read("/approvals")),
    ).toEqual([
      expect.objectContaining({
        id: deployment.id,
        approval: expect.objectContaining({ status: "pending" }),
      }),
    ]);
    const path = `/deployments/${deployment.id}/approval`;
    const decision = { decision: "approve", reason: "reviewed the release" };
    expect(await status(path, "admin", decision)).toBe(403);
    // The shared client the hub and toolkit decide through parses the answer.
    const client = createDeliveryClient({
      baseUrl: "http://delivery.test",
      headers: { "tailscale-user-login": OPERATOR },
      fetch: async (input, init) => app.request(input, init),
    });
    expect(
      await client.approve(deployment.id, {
        decision: "approve",
        reason: "reviewed the release",
      }),
    ).toMatchObject({
      deploymentId: deployment.id,
      status: "granted",
      actor: OPERATOR,
      override: false,
    });
  });
});

describe("recovery and attestation", () => {
  test("an admin opens a recovery intent on a recovery-required deployment", async () => {
    const deployment = await requestDeploy();
    await context.delivery.claim(deployment.id, testExecutor);
    await context.delivery.finish(
      deployment.id,
      {
        status: "failed",
        message: "Sync outcome is unknown",
        observedRevisionId: context.fixture.versionSet.id,
        recoveryRequired: true,
        evidence: [],
      },
      testExecutor,
    );
    const current = await selection();
    const path = `/deployments/${deployment.id}/recovery-intents`;
    const body = {
      requestId: "inspect-1",
      reason: "Inspected the Application after the executor lost its lease",
      expectedGeneration: current.bindingGeneration,
    };
    const opened = await call("POST", path, "admin", body);
    expect(opened.status).toBe(201);
    const intent = RecoveryIntentV2Schema.parse(opened.json);
    expect(intent).toMatchObject({
      kind: "argo",
      deploymentId: deployment.id,
      outcome: "pending",
      settledAt: null,
    });
    const replay = await call("POST", path, "admin", body);
    expect(RecoveryIntentV2Schema.parse(replay.json).id).toBe(intent.id);
    expect(
      RecoveryIntentV2Schema.parse(
        await read(`/recovery-intents/${encodeURIComponent(intent.id)}`),
      ),
    ).toEqual(intent);
    const recorded = await detail(deployment.id);
    expect(recorded.recoveryIntents).toEqual([intent]);
    expect(await status(path, "deployer", body)).toBe(403);
  });

  test("attestations take a stage with at least one evidence entry", async () => {
    const deployment = await requestDeploy();
    const path = `/deployments/${deployment.id}/attestations`;
    expect(
      await status(path, "executor", { stage: "bootstrap", evidence: [] }),
    ).toBe(400);
    const attested = await call("POST", path, "executor", {
      stage: "bootstrap",
      evidence: [{ kind: "attestation", summary: "ran the bootstrap" }],
    });
    expect(attested.status).toBe(400);
    expect(JSON.stringify(attested.json)).toMatch(/operator-run/u);
  });
});

describe("catalog, lifecycle and restore", () => {
  test("catalog reconcile reports counts and the catalog revision it froze", async () => {
    expect(CatalogStateSchema.parse(await read("/catalog"))).toEqual({
      catalogRevision: null,
      reconciledAt: null,
    });
    const reconciled = await call(
      "POST",
      "/catalog/reconcile",
      "admin",
      await catalogDocument(),
    );
    expect(reconciled.status).toBe(200);
    const result = CatalogReconcileResultSchema.parse(reconciled.json);
    expect(result.created.environments).toBeGreaterThan(0);
    const state = CatalogStateSchema.parse(await read("/catalog"));
    expect(state.catalogRevision).toBe(result.catalogRevision);
    expect(state.reconciledAt).not.toBeNull();
    expect(await status("/catalog/reconcile", "admin", { services: [] })).toBe(
      400,
    );
  });

  test("a retired service's environments admit no deployment", async () => {
    const retired = await call("POST", "/services/arcade/retire", "admin", {
      requestId: "retire-arcade",
      reason: "The arcade experiment ended",
    });
    expect(ServiceLifecycleViewSchema.parse(retired.json)).toMatchObject({
      id: "arcade",
      lifecycle: "retired",
    });
    const current = await selection();
    expect(current.lifecycle).toBe("retired");
    expect(
      await status("/deployments", "deployer", {
        requestId: crypto.randomUUID(),
        environmentId: "arcade/prod",
        versionSetRevisionId: context.fixture.versionSet.id,
        expectedGeneration: current.bindingGeneration,
        kind: "deploy",
      }),
    ).toBe(409);
  });

  test("reconcile-after-restore compares every active environment with the stored snapshot", async () => {
    const body = { requestId: "restore-1" };
    expect(await status("/reconcile-after-restore", "admin", body)).toBe(500);
    snapshot = {
      writtenAt: new Date().toISOString(),
      catalogRevision: `sha256:${"c".repeat(64)}`,
      environments: [],
    };
    const compared = await call(
      "POST",
      "/reconcile-after-restore",
      "admin",
      body,
    );
    expect(compared.status).toBe(200);
    expect(
      ReconcileAfterRestoreSchema.parse(compared.json).environments,
    ).toContainEqual({
      id: "arcade/prod",
      record: null,
      snapshot: null,
      live: null,
      status: "match",
    });
  });
});
