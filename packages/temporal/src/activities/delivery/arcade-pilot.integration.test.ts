import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  createTestDatabase,
  createApp,
  createRecoveryInspector,
  Delivery,
  testExecutor,
} from "@shepherdjerred/delivery/testing";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  DeploymentDetailSchema,
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
  deliveryWorkflowId,
} from "@shepherdjerred/delivery/contract";
import type {
  DeploymentDetail,
  PipelineDefinition,
} from "@shepherdjerred/delivery/contract";
import { deliverySelection } from "#lib/delivery/selection.ts";
import { verifyDelivery } from "./execute.ts";

// Only Temporal's Activity host, CI attestation, and the external Argo/runtime
// boundary are simulated. HTTP authentication, PostgreSQL, shared API client,
// immutable selections, production acceptance verifier, rollback, and recovery
// inspection execute their real implementations. This is not live Arcade proof.
vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({ cancellationSignal: new AbortController().signal }),
  },
}));

const adminToken = "arcade-pilot-local-admin-credential";
const executorToken = "arcade-pilot-local-executor-credential";
const originalFetch = fetch;
let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let api: ReturnType<typeof Bun.serve>;
let boundary: ReturnType<typeof Bun.serve>;
let pipeline: PipelineDefinition;
let registration: ReturnType<typeof RegisterEnvironmentSchema.parse>;
let currentArgo: unknown;
let currentPod: unknown;
let healthRequests = 0;

function client() {
  return createDeliveryClient({
    baseUrl: api.url.origin,
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

async function executor(path: string, body: unknown) {
  const response = await fetch(new URL(`/api/v1/${path}`, api.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${executorToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`Local executor ${path}: HTTP ${String(response.status)}`);
  const result: unknown = await response.json();
  return result;
}

function startApi() {
  const app = createApp({
    delivery: new Delivery(cluster.database),
    peerAddress: () => "127.0.0.1",
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: async () => "verified",
    inspectRecovery: createRecoveryInspector({
      origin: boundary.url.origin,
      token: "local-read-only-observer",
    }),
    config: {
      publicOrigin: "http://localhost",
      machineCredentials: [
        {
          token: adminToken,
          principal: {
            id: "pilot-admin",
            kind: "machine",
            scopes: ["read", "admin", "deploy", "publish"],
          },
        },
        { token: executorToken, principal: testExecutor },
      ],
      writesEnabled: async () => true,
      enabledEnvironments: async () => [registration.id],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
    },
  });
  api = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
  vi.stubEnv("DELIVERY_API_URL", api.url.origin);
}

beforeAll(async () => {
  pipeline = PipelineDefinitionSchema.parse(
    await Bun.file(
      new URL(
        "../../../../delivery/registrations/arcade.pipeline.json",
        import.meta.url,
      ),
    ).json(),
  );
  registration = RegisterEnvironmentSchema.parse(
    await Bun.file(
      new URL(
        "../../../../delivery/registrations/arcade.environment.json",
        import.meta.url,
      ),
    ).json(),
  );
  cluster = await createTestDatabase();
  boundary = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(incoming) {
      const url = new URL(incoming.url);
      if (url.pathname === "/runtime/health") {
        healthRequests += 1;
        return Response.json({ status: "ok" });
      }
      if (url.pathname === "/api/v1/applications/arcade")
        return Response.json(currentArgo);
      if (url.pathname === "/api/v1/applications/arcade/resource-tree")
        return Response.json({
          nodes: [{ kind: "Pod", name: "arcade-pilot", namespace: "arcade" }],
        });
      return url.pathname === "/api/v1/applications/arcade/resource"
        ? Response.json({ manifest: JSON.stringify(currentPod) })
        : new Response("Unknown local boundary", { status: 404 });
    },
  });
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.href === "https://arcade.sjer.red/health")
        return originalFetch(new URL("/runtime/health", boundary.url), init);
      if (url.origin !== api.url.origin && url.origin !== boundary.url.origin)
        throw new Error("Pilot integration cannot contact a live endpoint");
      return originalFetch(input, init);
    },
  );
  startApi();
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", executorToken);
  vi.stubEnv("ARGOCD_SERVER_URL", boundary.url.origin);
  vi.stubEnv("ARGOCD_TOKEN", "local-argo-readback-credential");
  await client().registerPipeline(registration.pipelineRevisionId, pipeline);
  await client().registerEnvironment(registration);
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await api.stop(true);
  await boundary.stop(true);
  await cluster.close();
});

async function publish(number: number) {
  const imageDigest = `sha256:${String(number).repeat(64)}`;
  const chartVersion = `2.0.0-${String(number)}`;
  const publication = await client().publish({
    requestId: `pilot/build/${String(number)}`,
    serviceId: registration.serviceId,
    sourceRevision: String(number).repeat(40),
    ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
    verifiedAt: new Date().toISOString(),
    artifacts: [
      {
        id: `pilot/image/${String(number)}`,
        component: "image:arcade",
        kind: "image",
        uri: "docker.io/shepherdjerred/arcade",
        digest: imageDigest,
        version: `build-${String(number)}`,
      },
      {
        id: `pilot/chart/${String(number)}`,
        component: "chart:arcade",
        kind: "chart",
        uri: `https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-${chartVersion}.tgz`,
        digest: `sha256:${"a".repeat(64)}`,
        version: chartVersion,
      },
    ],
  });
  await executor(`builds/${publication.buildId}/qualify`, {});
  const versions = await client().versions(registration.serviceId);
  const selected = versions[0];
  if (selected === undefined)
    throw new Error("Local qualification created no version set");
  return selected;
}

async function request(
  versionId: string,
  requestId: string,
  kind: "deploy" | "rollback" = "deploy",
) {
  const overview = await client().overview();
  const environment = overview.environments[0];
  if (environment === undefined) throw new Error("Pilot environment missing");
  return await client().createDeployment({
    requestId,
    environmentId: registration.id,
    versionSetRevisionId: versionId,
    expectedGeneration: environment.generation,
    kind,
  });
}

function observe(
  detail: DeploymentDetail,
  phase: "Running" | "Succeeded",
  runtimeDigest?: string,
) {
  const { selection, operationId } = deliverySelection(detail);
  const image = detail.versionSet.components["image:arcade"];
  if (image === undefined)
    throw new Error("Real Arcade image component missing");
  expect(selection.parameters["delivery.image"]).toBe(
    `${image.uri}@${image.digest}`,
  );
  expect(selection.parameters["image.ref"]).toBeUndefined();
  const source = {
    repoURL: selection.repository,
    chart: selection.chart,
    targetRevision: selection.revision,
    helm: {
      parameters: Object.entries(selection.parameters).map(([name, value]) => ({
        name,
        value,
        forceString: true,
      })),
    },
  };
  const externalId = crypto.randomUUID();
  currentArgo = {
    metadata: {
      name: "arcade",
      uid: "local-arcade-uid",
      resourceVersion: "local-1",
      annotations: {
        "delivery.shepherdjerred.com/environment": registration.id,
      },
    },
    spec: {
      source,
      destination: { namespace: "arcade" },
      syncPolicy: { automated: { enabled: false } },
    },
    status: {
      sync: { status: "Synced", revision: selection.revision },
      health: { status: "Healthy" },
      resources: [],
      operationState: {
        phase,
        ...(phase === "Succeeded"
          ? { finishedAt: new Date().toISOString() }
          : {}),
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: operationId },
            { name: "ci.sjer.red/operation-id", value: externalId },
          ],
        },
        syncResult: { revision: selection.revision },
      },
      history: [{ id: 1, revision: selection.revision, source }],
    },
  };
  currentPod = {
    metadata: {},
    spec: {
      containers: [{ name: "arcade", image: `${image.uri}@${image.digest}` }],
    },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "arcade",
          imageID: `containerd://${runtimeDigest ?? image.digest}`,
          ready: true,
          state: { running: {} },
        },
      ],
    },
  };
  return { operationId, externalId };
}

async function claim(id: string) {
  const detail = DeploymentDetailSchema.parse(
    await executor(`deployments/${id}/claim`, {}),
  );
  const operationId = deliverySelection(detail).operationId;
  await executor(`deployments/${id}/stages`, {
    key: "reconcile",
    status: "running",
    operationId,
    message: "Local Argo boundary intent",
  });
  return detail;
}

async function accept(id: string, detail: DeploymentDetail) {
  const { operationId } = observe(detail, "Succeeded");
  await executor(`deployments/${id}/stages`, {
    key: "reconcile",
    status: "succeeded",
    operationId,
    message: "Local Argo boundary settled",
  });
  const evidence = await verifyDelivery(id);
  expect(evidence.map((entry) => entry.kind)).toContain("runtime");
  await executor(`deployments/${id}/finish`, {
    status: "succeeded",
    message: "Local pilot accepted",
    observedRevisionId: detail.versionSet.id,
    evidence,
  });
  return await client().deployment(id);
}

test("real Arcade definition accepts, rolls back exact frozen inputs, and recovers ownership after an API restart", async () => {
  const first = await publish(1);
  const baseline = await request(first.id, "pilot/baseline");
  const acceptedBaseline = await accept(baseline.id, await claim(baseline.id));
  expect(acceptedBaseline.environment.acceptedVersionSetRevisionId).toBe(
    first.id,
  );

  await client().registerPipeline("arcade/3", pipeline);
  await client().registerEnvironment({
    ...registration,
    pipelineRevisionId: "arcade/3",
    configurationRevision: "arcade/2",
  });
  const second = await publish(2);
  const newer = await request(second.id, "pilot/newer");
  await accept(newer.id, await claim(newer.id));
  const rollback = await request(first.id, "pilot/rollback", "rollback");
  const frozenRollback = await claim(rollback.id);
  expect(frozenRollback.deployment.pipelineRevisionId).toBe(
    registration.pipelineRevisionId,
  );
  expect(frozenRollback.deployment.configurationId).toBe(
    registration.configurationRevision,
  );
  expect(frozenRollback.configuration.content).toEqual(
    registration.configuration,
  );
  const rolledBack = await accept(rollback.id, frozenRollback);
  expect(rolledBack.environment.acceptedVersionSetRevisionId).toBe(first.id);
  expect(await executor("reconcile", {})).toEqual({ deployments: [] });

  const interrupted = await request(second.id, "pilot/interrupted");
  const frozenInterrupted = await claim(interrupted.id);
  const pending = observe(frozenInterrupted, "Running");
  await api.stop(true);
  startApi();
  const afterRestart = await client().deployment(interrupted.id);
  expect(afterRestart.environment.activeDeploymentId).toBe(interrupted.id);
  expect(afterRestart.environment.desiredVersionSetRevisionId).toBe(second.id);
  expect(afterRestart.environment.acceptedVersionSetRevisionId).toBe(first.id);
  await executor(`deployments/${interrupted.id}/orphan`, {
    workflowId: deliveryWorkflowId(interrupted.id),
    workflowStatus: "TIMED_OUT",
    reason:
      "Local test simulates independent observation of a timed-out Workflow",
  });
  const orphan = await client().deployment(interrupted.id);
  expect(orphan.deployment.recoveryRequired).toBe(true);
  expect(orphan.environment.activeDeploymentId).toBe(interrupted.id);
  await expect(
    client().retry(interrupted.id, {
      requestId: "pilot/retry-while-locked",
      expectedGeneration: orphan.environment.generation,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const reason =
    "Local pilot independently inspected the exact settled Argo operation";
  await expect(
    client().recover(interrupted.id, {
      operationId: pending.externalId,
      reason,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const settled = observe(frozenInterrupted, "Succeeded");
  await client().recover(interrupted.id, {
    operationId: settled.externalId,
    reason,
  });
  const recovered = await client().deployment(interrupted.id);
  expect(recovered.environment.activeDeploymentId).toBeNull();
  expect(recovered.deployment.recoveryRequired).toBe(false);
  expect(recovered.deployment.status).toBe("failed");
  expect(recovered.environment.acceptedVersionSetRevisionId).toBe(first.id);
  expect(
    recovered.evidence.some(
      (entry) =>
        entry.operationId === settled.externalId &&
        entry.summary.includes("Independent Argo readback"),
    ),
  ).toBe(true);
  const retried = await client().retry(interrupted.id, {
    requestId: "pilot/retry-after-recovery",
    expectedGeneration: recovered.environment.generation,
  });
  const retryDetail = await claim(retried.id);
  observe(retryDetail, "Succeeded", `sha256:${"f".repeat(64)}`);
  await expect(verifyDelivery(retried.id)).rejects.toThrow(
    "Runtime alias lacks its selected repository or running config identity",
  );
  const staleRuntime = await client().deployment(retried.id);
  expect(staleRuntime.environment.acceptedVersionSetRevisionId).toBe(first.id);
  const acceptedRetry = await accept(retried.id, retryDetail);
  expect(acceptedRetry.environment.acceptedVersionSetRevisionId).toBe(
    second.id,
  );
  expect(healthRequests).toBe(4);
}, 60_000);
