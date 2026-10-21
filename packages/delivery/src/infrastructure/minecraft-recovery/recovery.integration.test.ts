import { createHash } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import {
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
} from "#shared/contract.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import sourceFixture from "@shepherdjerred/ops-model/fixtures/minecraft-recovery-source.json" with { type: "json" };
import { createMinecraftRecoveryInspector } from "./inspector.ts";
import { createApp } from "#server/app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import { catalogComponents } from "#infrastructure/upstream-artifact.ts";

const context = useDeliveryFixture();
// Acquisition follows the committed catalog pin, so a Renovate bump keeps this fixture valid.
const pinned = catalogComponents.find((entry) => entry.name === "minecraft");
if (pinned === undefined)
  throw new Error("The version catalog no longer pins the Minecraft chart");
const chartVersion = pinned.value;
const reason =
  "Inspect and reopen the original before any candidate source selection";
const directory = new URL(
  "../../../registrations/specialized/minecraft-tsmc/",
  import.meta.url,
);
let deploymentId: string;
let operationId: string;
let generation: number;
beforeEach(async () => {
  const definition = PipelineDefinitionSchema.parse(
    await Bun.file(new URL("pipeline.json", directory)).json(),
  );
  const registration = RegisterEnvironmentSchema.parse(
    await Bun.file(new URL("environment.json", directory)).json(),
  );
  const bytes = new TextEncoder().encode(
      "isolated upstream Minecraft chart fixture",
    ),
    digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const acquired = await context.delivery.acquireUpstreamArtifact(
    {
      requestId: "minecraft/upstream",
      serviceId: "minecraft",
      sourceRevision: "a".repeat(40),
      artifact: {
        id: "minecraft/chart",
        component: "chart:minecraft",
        kind: "chart",
        uri: `https://chartmuseum.sjer.red/charts/minecraft-${chartVersion}.tgz`,
        version: chartVersion,
        digest,
        origin: {
          kind: "upstream",
          repository: "https://itzg.github.io/minecraft-server-charts/",
          name: "minecraft",
          version: chartVersion,
          checksum: digest,
        },
      },
    },
    testPublisher,
    {
      transport: async (url) =>
        url.toString().endsWith("index.yaml")
          ? Response.json({
              entries: {
                minecraft: [
                  {
                    name: "minecraft",
                    version: chartVersion,
                    digest: digest.slice(7),
                    urls: [
                      `https://github.com/itzg/minecraft-server-charts/releases/download/minecraft-${chartVersion}/minecraft-${chartVersion}.tgz`,
                    ],
                  },
                ],
              },
            })
          : new Response(bytes),
    },
  );
  const build = await context.delivery.publish(
    {
      requestId: "minecraft/ci",
      serviceId: "minecraft",
      sourceRevision: "b".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/2",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "minecraft/image",
          component: "image:the-storm-server",
          kind: "image",
          uri: "docker.io/shepherdjerred/the-storm-server",
          version: "candidate",
          digest: `sha256:${"b".repeat(64)}`,
        },
      ],
      retainedArtifactIds: [acquired.artifact.id],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 2 },
  );
  await context.delivery.qualify(build.buildId, "verified", testExecutor);
  const [version] = await context.delivery.versions("minecraft");
  if (version === undefined)
    throw new Error("Missing qualified Minecraft candidate");
  await context.delivery.registerPipeline(
    registration.pipelineRevisionId,
    definition,
    testOperator,
  );
  const environment = await context.delivery.registerEnvironment(
    registration,
    testOperator,
  );
  const deployment = await context.delivery.createDeployment(
    {
      requestId: "minecraft/deploy",
      environmentId: environment.id,
      expectedGeneration: environment.generation,
      kind: "deploy",
      versionSetRevisionId: version.id,
    },
    testOperator,
  );
  deploymentId = deployment.id;
  operationId = deliveryOperationId(`${deploymentId}:minecraft-preservation`);
  const claimed = await context.delivery.claim(deploymentId, testExecutor);
  generation = claimed.environment.generation;
});

function controller(uid = "native-controller-1") {
  return {
    namespace: "delivery-tsmc-controller" as const,
    name: "delivery-tsmc-controller-0" as const,
    uid,
    requestId: operationId,
    specFingerprint: "c".repeat(64),
    sourceFingerprint: "d".repeat(64),
  };
}

test("preservation completion appends immutable proof without replacing its legacy native receipt", async () => {
  const key = "minecraft-preservation-1",
    prefix = `${deploymentId}/stage/${key}/`;
  const native = {
    kind: "preflight" as const,
    operationId: controller().uid,
    summary: JSON.stringify({
      adapter: "minecraft-preservation-controller",
      ...controller(),
    }),
  };
  const legacy = await context.cluster.database.evidence.create({
    data: { id: prefix + "0", deploymentId, ...native },
  });
  const stage = {
    key,
    status: "running" as const,
    operationId,
    message: JSON.stringify(controller()),
  };
  await context.delivery.stage(
    deploymentId,
    { ...stage, evidence: [native] },
    testExecutor,
  );
  const final = {
    ...stage,
    status: "succeeded" as const,
    message: "Independent restore and gameplay verified",
    evidence: [
      {
        kind: "backup" as const,
        operationId,
        summary: "Exact independent restore and whole-volume proof",
      },
      {
        kind: "preflight" as const,
        operationId,
        summary: "Exact candidate gameplay and untouched original reopening",
      },
    ],
  };
  await context.delivery.stage(deploymentId, final, testExecutor);
  await context.delivery.stage(deploymentId, final, testExecutor);
  const rows = await context.cluster.database.evidence.findMany({
    where: { deploymentId, id: { startsWith: prefix } },
  });
  expect(rows).toHaveLength(3);
  expect(rows.find((row) => row.id === legacy.id)).toEqual(legacy);
  expect(rows.map((row) => row.summary).sort()).toEqual(
    [native.summary, ...final.evidence.map((item) => item.summary)].sort(),
  );
  await expect(
    context.delivery.stage(
      deploymentId,
      { ...final, operationId: "foreign-op" },
      testExecutor,
    ),
  ).rejects.toThrow("Stage operation identity cannot change");
  await expect(
    context.delivery.stage(
      deploymentId,
      { ...final, message: "rewritten" },
      testExecutor,
    ),
  ).rejects.toThrow("Completed stage cannot be rewritten");
  const proof = rows.find((row) => row.kind === "backup");
  if (!proof) throw new Error("Backup proof missing");
  await context.cluster.database.evidence.update({
    where: { id: proof.id },
    data: { summary: "corrupt stored receipt" },
  });
  await expect(
    context.delivery.stage(deploymentId, final, testExecutor),
  ).rejects.toThrow("Evidence cannot be rewritten");
});

test("ordinary pipelines cannot request append evidence through a preservation stage key", async () => {
  const ordinary = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.delivery.claim(ordinary.id, testExecutor);
  const stage = {
    key: "minecraft-preservation-1",
    status: "running" as const,
    operationId: "ordinary-op",
    message: "ordinary",
    evidence: [{ kind: "preflight" as const, summary: "original" }],
  };
  await context.delivery.stage(ordinary.id, stage, testExecutor);
  await expect(
    context.delivery.stage(
      ordinary.id,
      { ...stage, evidence: [{ kind: "backup", summary: "changed" }] },
      testExecutor,
    ),
  ).rejects.toThrow("Evidence cannot be rewritten");
});
async function quarantine(completed = false, receipt = true) {
  await context.delivery.stage(
    deploymentId,
    {
      key: "minecraft-preservation-1",
      status: completed ? "succeeded" : "running",
      operationId,
      message: completed
        ? "Preserved before executor interruption"
        : "Awaiting callback",
      evidence: receipt
        ? [
            {
              kind: "preflight",
              operationId: controller().uid,
              summary: JSON.stringify({
                adapter: "minecraft-preservation-controller",
                ...controller(),
              }),
            },
          ]
        : [],
    },
    testExecutor,
  );
  await context.delivery.finish(
    deploymentId,
    {
      status: "failed",
      message: "Executor interrupted before candidate selection",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  return context.delivery.requestMinecraftRecovery(
    deploymentId,
    {
      requestId: "minecraft/recover",
      reason,
      expectedEnvironmentGeneration: generation,
    },
    testOperator,
  );
}
function nativeProof() {
  const image = `docker.io/shepherdjerred/the-storm-server:accepted@sha256:${"a".repeat(64)}`;
  const source = structuredClone(sourceFixture.source);
  const application = {
    uid: "argo-original",
    resourceVersion: "9",
    sourceSha256: sourceFixture.sha256,
    operationPhase: "none",
  };
  const report = {
    schemaVersion: 1,
    kind: "storm-preselection-recovery",
    requestId: operationId,
    observedAt: new Date().toISOString(),
    journalSha256: "e".repeat(64),
    phase: "REOPENED",
    productionWriteAuthorized: false,
    originalReopened: true,
    helpersAbsent: true,
    copyAbsent: true,
    source: {
      serverUid: "server-original",
      resourceVersion: "7",
      templateSha256: "f".repeat(64),
      image,
      claimUid: "claim-original",
      claimResourceVersion: "7",
      volumeName: "pv-original",
      volumeUid: "volume-original",
      volumeResourceVersion: "7",
      volumeSource: { driver: "zfs", volumeHandle: "original-dataset" },
      replicas: 1,
    },
    pods: [
      {
        uid: "pod-original",
        resourceVersion: "7",
        image,
        ownerUid: "server-original",
        claimName: "datadir-minecraft-tsmc-0",
      },
    ],
    routes: [
      "minecraft-tsmc",
      "minecraft-tsmc-bedrock",
      "minecraft-tsmc-bluemap",
      "minecraft-tsmc-rcon",
    ].map((name) => ({
      name,
      uid: name,
      resourceVersion: "7",
      selectorSha256: "a".repeat(64),
    })),
    application,
  };
  return {
    report,
    argo: {
      metadata: {
        uid: application.uid,
        resourceVersion: application.resourceVersion,
      },
      spec: { source },
      status: { resources: [] },
    },
  };
}
function transport(proof = nativeProof(), native = controller()) {
  let reads = 0;
  const inspect = createMinecraftRecoveryInspector({
    controllerOrigin: "http://controller.test",
    executorToken: "local-executor-test",
    readApplication: async (name) => {
      reads++;
      expect(name).toBe("minecraft-tsmc");
      return proof.argo;
    },
    fetch: async (url, init) => {
      reads++;
      expect(url instanceof Request ? url.url : url.toString()).toContain(
        "controller.test",
      );
      expect(init?.body).toContain('"recoveryId":"minecraft/recover"');
      const reportJson = JSON.stringify(proof.report);
      return Response.json({
        requestId: operationId,
        controller: native,
        reportJson,
        reportSha256: `sha256:${createHash("sha256").update(reportJson).digest("hex")}`,
      });
    },
  });
  return { inspect, reads: () => reads };
}
function completion(intent: { snapshotFingerprint: string }) {
  return {
    snapshotFingerprint: intent.snapshotFingerprint,
    expectedEnvironmentGeneration: generation,
  };
}
async function retained() {
  expect(
    await context.cluster.database.targetLock.count({
      where: { deploymentId },
    }),
  ).toBe(1);
  expect(
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deploymentId },
    }),
  ).toMatchObject({ status: "failed", recoveryRequired: true });
}

test("completed preservation can independently recover the exact original without accepting the interrupted release", async () => {
  const intent = await quarantine(true);
  await context.delivery.recordMinecraftRecoveryController(
    intent.id,
    controller("native-controller-restarted"),
    testExecutor,
  );
  const boundary = transport(
    nativeProof(),
    controller("native-controller-restarted"),
  );
  expect(
    await context.delivery.completeMinecraftRecovery(
      intent.id,
      completion(intent),
      testExecutor,
      boundary.inspect,
    ),
  ).toMatchObject({ status: "succeeded" });
  expect(boundary.reads()).toBe(2);
  expect(await context.cluster.database.targetLock.count()).toBe(0);
  expect(
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deploymentId },
    }),
  ).toMatchObject({ status: "failed", recoveryRequired: false });
  expect(
    await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: "minecraft/tsmc" },
    }),
  ).toMatchObject({
    activeDeploymentId: null,
    acceptedVersionSetRevisionId: null,
  });
  await context.delivery.completeMinecraftRecovery(
    intent.id,
    completion(intent),
    testExecutor,
    boundary.inspect,
  );
  expect(boundary.reads()).toBe(2);
});

test("missing receipt callback requires the original controller journal receipt before independent completion", async () => {
  const intent = await quarantine(false, false);
  const boundary = transport();
  await expect(
    context.delivery.completeMinecraftRecovery(
      intent.id,
      completion(intent),
      testExecutor,
      boundary.inspect,
    ),
  ).rejects.toThrow("recorded original native controller");
  expect(boundary.reads()).toBe(0);
  await retained();
  await context.delivery.recordMinecraftRecoveryController(
    intent.id,
    controller(),
    testExecutor,
  );
  expect(
    await context.delivery.completeMinecraftRecovery(
      intent.id,
      completion(intent),
      testExecutor,
      boundary.inspect,
    ),
  ).toMatchObject({ status: "succeeded" });
});

test("changed source, stale native proof and controller replacement retain the quarantine", async () => {
  const intent = await quarantine();
  await context.delivery.recordMinecraftRecoveryController(
    intent.id,
    controller(),
    testExecutor,
  );
  const changed = nativeProof();
  changed.argo.spec.source.targetRevision = "candidate";
  await expect(
    context.delivery.completeMinecraftRecovery(
      intent.id,
      completion(intent),
      testExecutor,
      transport(changed).inspect,
    ),
  ).rejects.toThrow("Argo source");
  const stale = nativeProof();
  stale.report.observedAt = new Date(Date.now() - 60_000).toISOString();
  await expect(
    context.delivery.completeMinecraftRecovery(
      intent.id,
      completion(intent),
      testExecutor,
      transport(stale).inspect,
    ),
  ).rejects.toThrow("stale");
  await expect(
    context.delivery.completeMinecraftRecovery(
      intent.id,
      completion(intent),
      testExecutor,
      transport(nativeProof(), controller("foreign-pod")).inspect,
    ),
  ).rejects.toThrow("recorded native request");
  await expect(
    context.delivery.recordMinecraftRecoveryController(
      intent.id,
      { ...controller(), sourceFingerprint: "0".repeat(64) },
      testExecutor,
    ),
  ).rejects.toThrow("original native source");
  await retained();
});

test("environment CAS change after independent reads prevents release and failed recovery stays immutable", async () => {
  const intent = await quarantine();
  await context.delivery.recordMinecraftRecoveryController(
    intent.id,
    controller(),
    testExecutor,
  );
  const boundary = transport();
  await expect(
    context.delivery.completeMinecraftRecovery(
      intent.id,
      completion(intent),
      testExecutor,
      async (...args) => {
        const observation = await boundary.inspect(...args);
        await context.cluster.database.environment.update({
          where: { id: "minecraft/tsmc" },
          data: { generation: { increment: 1 } },
        });
        return observation;
      },
    ),
  ).rejects.toThrow("environment generation");
  await retained();
  await context.delivery.failMinecraftRecovery(
    intent.id,
    "Independent inspection found a changed source owner",
    testExecutor,
  );
  await expect(
    context.delivery.completeMinecraftRecovery(
      intent.id,
      completion(intent),
      testExecutor,
      boundary.inspect,
    ),
  ).rejects.toThrow("immutable");
  await context.delivery.failMinecraftRecovery(
    intent.id,
    "Independent inspection found a changed source owner",
    testExecutor,
  );
  await retained();
});

test("source selection intent blocks cleanup even if the candidate has not visibly reconciled", async () => {
  await context.delivery.stage(
    deploymentId,
    {
      key: "reconcile",
      status: "running",
      operationId: crypto.randomUUID(),
      message: "Source selection admitted",
      evidence: [],
    },
    testExecutor,
  );
  await expect(quarantine()).rejects.toThrow("source selection was admitted");
  await retained();
});

test("HTTP auth rejects publishers, caller-shaped observations, and allows independent cleanup while release writes are paused", async () => {
  await quarantine();
  const app = createApp({
    delivery: context.delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: async () => "verified",
    inspectMinecraftRecovery: transport().inspect,
    peerAddress: () => null,
    config: {
      publicOrigin: "http://delivery.test",
      writesEnabled: async () => false,
      enabledEnvironments: async () => [],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
      machineCredentials: [
        {
          token: "minecraft-recovery-test-publisher",
          principal: testPublisher,
        },
        {
          token: "minecraft-recovery-test-admin",
          principal: { ...testExecutor, scopes: ["read", "execute", "admin"] },
        },
      ],
    },
  });
  const publisher = createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { authorization: "Bearer minecraft-recovery-test-publisher" },
    fetch: async (url, init) => app.request(url, init),
  });
  await expect(
    publisher.requestMinecraftRecovery(deploymentId, {
      requestId: "unauthorized",
      expectedEnvironmentGeneration: generation,
      reason,
    }),
  ).rejects.toMatchObject({ status: 403 });
  const response = await app.request(
    "/api/v1/minecraft-recovery/minecraft%2Frecover/complete",
    {
      method: "POST",
      headers: {
        authorization: "Bearer minecraft-recovery-test-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedEnvironmentGeneration: generation,
        snapshotFingerprint: "a".repeat(64),
        evidence: "healthy",
      }),
    },
  );
  expect(response.status).toBe(400);
  await retained();
  const admin = createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { authorization: "Bearer minecraft-recovery-test-admin" },
    fetch: async (url, init) => app.request(url, init),
  });
  const pending = await admin.minecraftRecovery("minecraft/recover");
  const headers = {
    authorization: "Bearer minecraft-recovery-test-admin",
    "content-type": "application/json",
  };
  const recorded = await app.request(
    "/api/v1/minecraft-recovery/minecraft%2Frecover/controller",
    { method: "POST", headers, body: JSON.stringify(controller()) },
  );
  expect(recorded.status).toBe(200);
  const completed = await app.request(
    "/api/v1/minecraft-recovery/minecraft%2Frecover/complete",
    {
      method: "POST",
      headers,
      body: JSON.stringify(completion(pending.intent)),
    },
  );
  expect(completed.status).toBe(200);
  const settled = await admin.minecraftRecovery("minecraft/recover");
  expect(settled.intent.status).toBe("succeeded");
});
