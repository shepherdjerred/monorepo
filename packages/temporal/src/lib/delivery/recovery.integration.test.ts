import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createTestDatabase,
  createApp,
  createRecoveryInspector,
  fakeApplicationReader,
  Delivery,
  seedDelivery,
  testExecutor,
  testOperator,
  testPublisher,
} from "@shepherdjerred/delivery/testing";
import { DELIVERY_ROOT_IGNORE_EXPRESSIONS } from "homelab/src/delivery-ownership.ts";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { deliveryRecoverySelection } from "./recovery.ts";
import { deliveryOperationId } from "./selection.ts";

const chartBytes = "immutable recovery chart";
const jsonPatch = z.object({ patch: z.string() });
const syncInput = z.object({
  revision: z.string(),
  infos: z.array(z.object({ name: z.string(), value: z.string() })),
});

function assertInvalidRecoveryExports(detail: DeploymentDetail) {
  expect(() =>
    deliveryRecoverySelection({
      ...detail,
      environment: { ...detail.environment, activeDeploymentId: null },
    }),
  ).toThrow("original environment lock");
  expect(() =>
    deliveryRecoverySelection({
      ...detail,
      configuration: {
        ...detail.configuration,
        content: { "database.password": "rejected-fixture" },
      },
    }),
  ).toThrow("credential parameter");
  expect(() =>
    deliveryRecoverySelection({
      ...detail,
      stages: detail.stages.map((stage) => ({
        ...stage,
        operationId: "11111111-1111-4111-8111-111111111111",
      })),
    }),
  ).toThrow("recorded reconciliation stage");
}

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let store: Delivery;
let server: ReturnType<typeof Bun.serve>;
/** The registered store the chart is published to (A6); a local fake then serves its bytes. */
const CHART_REPOSITORY = "https://chartmuseum.tailnet-1a49.ts.net";
let current: Record<string, unknown>;
let versionId: string;
let directory: string;
let patchCount = 0;
async function setup() {
  cluster = await createTestDatabase();
  store = new Delivery(cluster.database);
  await seedDelivery(store);
  directory = await mkdtemp(path.join(tmpdir(), "delivery-recovery-"));
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/charts/")) return new Response(chartBytes);
      if (url.pathname === "/api/v1/applications/apps")
        return Response.json({
          spec: {
            syncPolicy: { syncOptions: ["RespectIgnoreDifferences=true"] },
            ignoreDifferences: [
              {
                group: "argoproj.io",
                kind: "Application",
                jqPathExpressions: DELIVERY_ROOT_IGNORE_EXPRESSIONS,
              },
            ],
          },
        });
      if (url.pathname.endsWith("/managed-resources"))
        return Response.json({ items: [] });
      if (url.pathname.endsWith("/manifests"))
        return Response.json({ manifests: [] });
      if (request.method === "PATCH") {
        const patch = z
          .array(
            z.object({
              op: z.string(),
              path: z.string(),
              value: z.unknown(),
            }),
          )
          .parse(JSON.parse(jsonPatch.parse(await request.json()).patch));
        expect(patch[0]).toMatchObject({
          op: "test",
          path: "/metadata/resourceVersion",
          value: "123",
        });
        const source = patch.find(
          (entry) => entry.path === "/spec/source",
        )?.value;
        current["spec"] = {
          ...z.record(z.string(), z.unknown()).parse(current["spec"]),
          source,
        };
        patchCount += 1;
        return Response.json(current);
      }
      if (url.pathname.endsWith("/sync")) {
        const input = syncInput.parse(await request.json());
        const operation = {
          sync: { revision: input.revision },
          info: input.infos,
        };
        current["status"] = {
          operationState: {
            phase: "Succeeded",
            operation,
            finishedAt: "2026-10-17T00:00:00Z",
            syncResult: { revision: input.revision },
          },
          resources: [],
        };
        return Response.json({ operation });
      }
      return url.pathname === "/api/v1/applications/arcade"
        ? Response.json(current)
        : Response.json({ error: "Unexpected test request" }, { status: 404 });
    },
  });
  const publication = await store.publish(
    {
      requestId: "recovery-chart",
      serviceId: "arcade",
      sourceRevision: "a".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/2",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "recovery-chart",
          component: "chart",
          kind: "chart",
          uri: `${CHART_REPOSITORY}/charts/arcade-2.0.0-42.tgz`,
          version: "2.0.0-42",
          digest: `sha256:${createHash("sha256").update(chartBytes).digest("hex")}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 2 },
  );
  // The fake ChartMuseum serves the same bytes locally; the row keeps its store.
  await cluster.database.artifact.update({
    where: { id: "recovery-chart" },
    data: { uri: `${server.url.origin}/charts/arcade-2.0.0-42.tgz` },
  });
  await store.qualify(publication.buildId, "verified", testExecutor);
  const versions = await store.versions("arcade");
  const selected = versions[0];
  if (selected === undefined)
    throw new Error("Recovery version fixture missing");
  versionId = selected.id;
  await store.registerPipeline(
    "arcade/recovery",
    {
      kind: "argocd",
      application: "arcade",
      chartRepository: server.url.origin,
      chartName: "arcade",
      chartComponent: "chart",
      namespace: "arcade",
      parameters: {},
      artifactParameters: { "image.ref": "server" },
    },
    testOperator,
  );
  await store.registerEnvironment(
    {
      id: "arcade/prod",
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/recovery",
      configurationRevision: "config/recovery",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
}

describe("guarded recovery before and after Delivery source selection", () => {
  beforeAll(setup, 60_000);
  afterAll(async () => {
    await server.stop(true);
    await cluster.close();
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["before-selection", "after-selection"])(
    "settles %s with exact source and a real guarded operation receipt before unlocking",
    async (point) => {
      const env = await cluster.database.environment.findUniqueOrThrow({
        where: { id: "arcade/prod" },
      });
      const deployment = await store.createDeployment(
        {
          requestId: `recovery/${point}`,
          environmentId: env.id,
          expectedGeneration: env.generation,
          versionSetRevisionId: versionId,
          kind: "deploy",
        },
        testOperator,
      );
      await store.claim(deployment.id, testExecutor);
      await store.stage(
        deployment.id,
        {
          key: "reconcile",
          status: "running",
          operationId: deliveryOperationId(deployment.id),
          message: "External intent persisted",
          evidence: [],
        },
        testExecutor,
      );
      await store.finish(
        deployment.id,
        {
          status: "failed",
          message: "Worker stopped before sync submission",
          recoveryRequired: true,
          evidence: [],
        },
        testExecutor,
      );
      const detail = await store.detail(deployment.id);
      assertInvalidRecoveryExports(detail);
      const frozen = deliveryRecoverySelection(detail);
      const parameters = Object.entries(frozen.selection.parameters).map(
        ([name, value]) => ({ name, value, forceString: true }),
      );
      current = {
        kind: "Application",
        metadata: {
          name: "arcade",
          resourceVersion: "123",
          annotations: {
            "delivery.shepherdjerred.com/environment": "arcade/prod",
          },
        },
        spec: {
          source: {
            repoURL: server.url.origin,
            chart: "arcade",
            targetRevision:
              point === "before-selection"
                ? "2.0.0-41"
                : frozen.selection.revision,
            helm: {
              parameters: point === "before-selection" ? [] : parameters,
            },
          },
          destination: { namespace: "arcade" },
          syncPolicy: { automated: { enabled: false } },
        },
        status: { resources: [] },
      };
      const inspector = createRecoveryInspector({
        readApplication: fakeApplicationReader(
          server.url.origin,
          "test-only-read-credential",
        ),
      });
      const app = createApp({
        delivery: store,
        peerAddress: () => "127.0.0.1",
        ciOrigin: "https://woodpecker.sjer.red",
        ciRepositoryId: 1,
        qualifyBuild: async () => "pending",
        inspectRecovery: inspector,
        config: {
          publicOrigin: "http://localhost",
          machineCredentials: [
            {
              token: "test-only-recovery-admin-credential",
              principal: {
                id: "recovery-admin",
                kind: "machine",
                scopes: ["read", "admin"],
              },
            },
          ],
          writesEnabled: async () => false,
          enabledEnvironments: async () => [],
          operatorLogins: async () => [],
          trustedProxyAddresses: async () => [],
        },
      });
      const unlock = async (operationId: string) =>
        await app.request(
          `/api/v1/deployments/${encodeURIComponent(deployment.id)}/release-lock`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer test-only-recovery-admin-credential",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              operationId,
              reason:
                "Inspected and settled the exact frozen release while Temporal was stopped",
            }),
          },
        );
      const notSettled = await unlock("11111111-1111-4111-8111-111111111111");
      expect(notSettled.ok).toBe(false);
      const stillOwned = await store.detail(deployment.id);
      expect(stillOwned.deployment.recoveryRequired).toBe(true);
      const file = path.join(directory, `${point}.json`);
      await Bun.write(file, JSON.stringify(frozen));
      const child = Bun.spawn(
        [
          process.execPath,
          "packages/homelab/scripts/argocd/argocd.ts",
          "sync-managed",
          "arcade",
          "--revision",
          frozen.selection.revision,
          "--request-id",
          frozen.requestId,
          "--delivery-selection",
          file,
          "--timeout",
          "2",
        ],
        {
          cwd: new URL("../../../../../", import.meta.url).pathname,
          env: {
            PATH: Bun.env["PATH"],
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-only-mutation-credential",
            ARGOCD_POLL_INTERVAL_MS: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      const receipt = z
        .object({
          status: z.object({
            operationState: z.object({
              operation: z.object({
                info: z.array(
                  z.object({ name: z.string(), value: z.string() }),
                ),
              }),
            }),
          }),
        })
        .parse(current).status.operationState.operation.info;
      expect(
        receipt.find((entry) => entry.name === "ci.sjer.red/request-id")?.value,
      ).toBe(frozen.requestId);
      const operationId = z
        .uuid()
        .parse(
          receipt.find((entry) => entry.name === "ci.sjer.red/operation-id")
            ?.value,
        );
      const settled = await unlock(operationId);
      expect(settled.status).toBe(200);
      const recovered = await store.detail(deployment.id);
      expect(recovered.deployment.recoveryRequired).toBe(false);
      expect(recovered.environment.activeDeploymentId).toBeNull();
      expect(recovered.environment.acceptedVersionSetRevisionId).toBeNull();
      expect(patchCount).toBe(point === "before-selection" ? 1 : 2);
    },
    60_000,
  );
});
