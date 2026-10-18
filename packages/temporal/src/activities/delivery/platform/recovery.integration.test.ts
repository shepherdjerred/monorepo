import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  controlPlaneFixture,
  createTestDatabase,
} from "@shepherdjerred/delivery/testing";
import {
  DeploymentDetailSchema,
  PlatformRecoveryContextSchema,
} from "@shepherdjerred/delivery/contract";
import type { V1Job, V1Pod } from "@kubernetes/client-node";
import { executionApiFixture } from "./execution-api-fixtures.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import { platformExecutionJob } from "#lib/delivery/platform/job-request.ts";
import { executePlatformRecoveryAction } from "#lib/delivery/platform/recovery/execute.ts";
import { provePlatformNativeJobs } from "#lib/delivery/platform/recovery/native-proof.ts";
import { inspectControlPlaneRecovery } from "#lib/delivery/platform/recovery/target-argo.ts";
import {
  controlPlaneJobInput,
  controlPlaneSelections,
} from "#lib/delivery/platform/control-plane.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import {
  DeliveryJobReceiptSchema,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let fixture: Awaited<ReturnType<typeof controlPlaneFixture>>;
let api: ReturnType<typeof executionApiFixture>;
let writes = true;
const jobs = new Map<string, V1Job>();
const pods = new Map<string, V1Pod[]>();
const reader = {
  job: async (name: string) => {
    const job = jobs.get(name);
    if (job === undefined)
      throw Object.assign(new Error("Job not found"), { code: 404 });
    return job;
  },
  pods: async (name: string) => pods.get(name) ?? [],
};
beforeAll(async () => {
  cluster = await createTestDatabase();
  fixture = await controlPlaneFixture(cluster.database);
  api = executionApiFixture(
    fixture.delivery,
    [fixture.environment.id],
    async () => writes,
  );
  vi.stubEnv("DELIVERY_API_URL", api.server.url.origin);
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "platform-test-executor");
}, 60_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await api.server.stop(true);
  await cluster.close();
});

function nativeJob(request: DeliveryJobRequest, failed = false) {
  const job = deliveryJobManifest(request);
  const receipt = DeliveryJobReceiptSchema.parse({
    namespace: job.metadata?.namespace,
    name: job.metadata?.name,
    uid: crypto.randomUUID(),
    specFingerprint:
      job.metadata?.annotations?.["delivery.shepherdjerred.com/fingerprint"],
    requestId: request.deploymentId,
  });
  if (job.metadata === undefined) throw new Error("Expected Job metadata");
  job.metadata.uid = receipt.uid;
  job.status = {
    active: 0,
    conditions: [{ type: failed ? "Failed" : "Complete", status: "True" }],
  };
  jobs.set(receipt.name, job);
  pods.set(receipt.name, [
    {
      metadata: {
        ownerReferences: [
          {
            apiVersion: "batch/v1",
            kind: "Job",
            name: receipt.name,
            uid: receipt.uid,
          },
        ],
      },
      status: { phase: failed ? "Failed" : "Succeeded" },
    },
  ]);
  return receipt;
}

test("real PG+HTTP outage recovery rejects replaced/live native executors, then independently settles exact controller while writes are paused without accepting failed release", async () => {
  const deployment = await api.operator.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
  );
  const detail = await deliveryRequest(
    `deployments/${encodeURIComponent(deployment.id)}/claim`,
    DeploymentDetailSchema,
    {},
  );
  const request = platformExecutionJob(detail);
  const native = nativeJob(request, true);
  await deliveryRequest(
    `deployments/${encodeURIComponent(deployment.id)}/stages`,
    z.unknown(),
    {
      key: request.stageKey,
      status: "running",
      operationId: native.name,
      message: JSON.stringify(native),
      evidence: [],
    },
  );
  await deliveryRequest(
    `deployments/${encodeURIComponent(deployment.id)}/finish`,
    z.unknown(),
    {
      status: "failed",
      message: "Native response unavailable",
      recoveryRequired: true,
      evidence: [],
    },
  );
  const failed = await fixture.delivery.detail(deployment.id);
  const intent = await api.operator.requestPlatformRecovery(deployment.id, {
    requestId: crypto.randomUUID(),
    expectedEnvironmentGeneration: failed.environment.generation,
    reason: "Independently verify exact native target during executor outage",
  });
  const base = `platform-recovery/${encodeURIComponent(intent.id)}`;
  const context = await deliveryRequest(base, PlatformRecoveryContextSchema);
  const original = jobs.get(native.name)!;
  original.metadata!.uid = crypto.randomUUID();
  await expect(provePlatformNativeJobs(context, reader)).rejects.toThrow(
    "replaced",
  );
  original.metadata!.uid = native.uid;
  original.status = { active: 1 };
  await expect(provePlatformNativeJobs(context, reader)).rejects.toThrow(
    "active",
  );
  original.status = {
    active: 0,
    conditions: [{ type: "Failed", status: "True" }],
  };
  const selected = controlPlaneSelections(
    controlPlaneJobInput(context.deployment),
  );
  const image = selected.snapshot.nextArtifact;
  const source = {
    repoURL: selected.next.selection.repository,
    chart: "delivery-control-plane",
    targetRevision: selected.next.selection.revision,
    helm: {
      parameters: Object.entries(selected.next.selection.parameters).map(
        ([name, value]) => ({ name, value, forceString: true }),
      ),
    },
  };
  const owned = crypto.randomUUID();
  const app = {
    kind: "Application",
    metadata: {
      uid: crypto.randomUUID(),
      name: "delivery-control-plane",
      resourceVersion: "42",
      annotations: {
        "delivery.shepherdjerred.com/environment":
          "delivery-control-plane/prod",
      },
    },
    spec: {
      source,
      destination: { namespace: "temporal" },
      syncPolicy: { automated: { enabled: false } },
    },
    status: {
      sync: { status: "Synced", revision: selected.next.selection.revision },
      health: { status: "Healthy" },
      operationState: {
        phase: "Succeeded",
        finishedAt: new Date().toISOString(),
        syncResult: { revision: selected.next.selection.revision },
        operation: {
          info: [
            {
              name: "ci.sjer.red/request-id",
              value: deliveryOperationId(`${deployment.id}:control-plane`),
            },
            { name: "ci.sjer.red/operation-id", value: owned },
          ],
        },
      },
      history: [{ id: 1, revision: selected.next.selection.revision, source }],
    },
  };
  const template = {
    kind: "Deployment",
    metadata: { name: "executor", namespace: "temporal" },
    spec: {
      replicas: 1,
      template: {
        metadata: { labels: { component: "delivery-worker" } },
        spec: {
          containers: [
            {
              name: "worker",
              image: `${image.uri}:${image.version}@${image.digest}`,
            },
          ],
        },
      },
    },
  };
  const observedPods = [
    {
      metadata: { labels: { component: "delivery-worker" } },
      spec: template.spec.template.spec,
      status: {
        phase: "Running",
        containerStatuses: [
          {
            name: "worker",
            ready: true,
            imageID: image.digest,
            state: { running: {} },
          },
        ],
      },
    },
  ];
  const effects = {
    read: async () => app,
    render: async () => [template],
    workloads: async () => [template],
    pods: async () => observedPods,
  };
  await expect(
    inspectControlPlaneRecovery(context, {
      ...effects,
      read: async () => ({ ...app, operation: { sync: {} } }),
    }),
  ).rejects.toThrow();
  writes = false;
  const result = await executePlatformRecoveryAction(intent.id, "inspect", {
    runJob: async (input, checkpoint) => {
      const receipt = nativeJob(input);
      // Native child writes its UID before a delayed create callback; both writes are idempotent.
      await deliveryRequest(`${base}/native`, z.unknown(), {
        action: "inspect",
        receipt,
      });
      await checkpoint(receipt);
      return await inspectControlPlaneRecovery(context, effects);
    },
    closedWorkflow: async () => ({
      workflowId: `delivery/${deployment.id}`,
      status: "FAILED",
    }),
    nativeJobs: async (current) =>
      await provePlatformNativeJobs(current, reader),
  });
  expect(result.status).toBe("settled");
  const after = await fixture.delivery.detail(deployment.id);
  expect(after.deployment.status).toBe("failed");
  expect(after.deployment.message).toBe(failed.deployment.message);
  expect(after.deployment.recoveryRequired).toBe(false);
  expect(after.environment.acceptedControlPlaneDeploymentId).toBeNull();
  expect(after.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(await cluster.database.platformLock.count()).toBe(0);
}, 60_000);
