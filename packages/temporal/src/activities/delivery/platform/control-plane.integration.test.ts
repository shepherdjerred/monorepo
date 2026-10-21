import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  controlPlaneFixture,
  createTestDatabase,
} from "@shepherdjerred/delivery/testing";
import {
  DeploymentDetailSchema,
  FindQualifiedArtifactSchema,
} from "@shepherdjerred/delivery/contract";
import {
  BootstrapDescriptorSchema,
  bootstrapRootManifest,
} from "homelab/scripts/ci/bootstrap-selection.ts";
import {
  verifyBootstrapControlPlane,
  BootstrapControlPlaneSchema,
} from "homelab/scripts/ci/bootstrap-control-plane.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import {
  ControlPlaneJobInputSchema,
  controlPlaneJobInput,
  controlPlaneSelections,
  requireExactControlPlaneSource,
} from "#lib/delivery/platform/control-plane.ts";
import { finishDelivery } from "#activities/delivery/execute.ts";
import type { runDeliveryJob } from "#lib/delivery/job.ts";
import { DeliveryJobReceiptSchema } from "#shared/delivery-job.ts";
import { executionApiFixture } from "./execution-api-fixtures.ts";
import { executeControlPlaneWithJob } from "./control-plane.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { admitPlatformNativeJob } from "#lib/delivery/platform/native-job.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let fixture: Awaited<ReturnType<typeof controlPlaneFixture>>;
let api: ReturnType<typeof executionApiFixture>;
let bootstrappedSource: unknown;
beforeAll(async () => {
  cluster = await createTestDatabase();
  fixture = await controlPlaneFixture(
    cluster.database,
    true,
    async (original) => {
      expect(await cluster.database.environment.count()).toBe(0);
      const versions = await Promise.all([
        original.delivery.versions("temporal"),
        original.delivery.versions("delivery-control-plane"),
      ]);
      const originals = versions
        .flat()
        .flatMap((version) => Object.values(version.components));
      const selected = BootstrapControlPlaneSchema.parse({
        image: originals.find(
          (artifact) => artifact.id === original.previous.artifactId,
        ),
        chart: originals.find(
          (artifact) => artifact.id === original.priorChart.artifactId,
        ),
      });
      const catalogApi = executionApiFixture(original.delivery, []);
      try {
        await verifyBootstrapControlPlane(selected, "/unused", (query) =>
          catalogApi.operator.findQualifiedArtifact(
            FindQualifiedArtifactSchema.parse(query),
          ),
        );
      } finally {
        await catalogApi.server.stop(true);
      }
      const procedureSource = "f".repeat(40);
      const manual = (repository: string) => ({
        repository,
        sourceRevision: procedureSource,
        version: "2.0.0-900",
        digest: `sha256:${"e".repeat(64)}`,
      });
      const descriptor = BootstrapDescriptorSchema.parse({
        schema: "delivery-bootstrap/v1",
        sourceRevision: procedureSource,
        pullRequest: 99,
        requestId: crypto.randomUUID(),
        revision: "2.0.0-901",
        deliveryUrl: "https://delivery.tailnet-1a49.ts.net",
        targets: ["delivery-control-plane"],
        images: {
          woodpecker: manual(
            "docker.io/shepherdjerred/woodpecker-config-extension",
          ),
          delivery: manual("docker.io/shepherdjerred/delivery"),
        },
        controlPlane: selected,
      });
      const root = bootstrapRootManifest(
        JSON.stringify({
          apiVersion: "argoproj.io/v1alpha1",
          kind: "Application",
          metadata: { name: "delivery-control-plane" },
          spec: {
            source: {
              repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
              chart: "delivery-control-plane",
              targetRevision: "~2.0.0-0",
            },
            destination: { namespace: "temporal" },
            syncPolicy: { automated: { enabled: false } },
          },
        }),
        [],
        descriptor,
        "",
      );
      bootstrappedSource = Bun.YAML.parse(root);
      expect(await cluster.database.environment.count()).toBe(0);
      expect(await cluster.database.deployment.count()).toBe(0);
    },
  );
  api = executionApiFixture(fixture.delivery, [fixture.environment.id]);
  vi.stubEnv("DELIVERY_API_URL", api.server.url.origin);
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "platform-test-executor");
}, 60_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await api.server.stop(true);
  await cluster.close();
});

test("genuine qualified bootstrap originals authorize the first managed controller source without a counterfeit accepted baseline", async () => {
  const deployment = await api.operator.requestControlPlaneUpgrade(
    fixture.environment.id,
    { ...fixture.input, requestId: "controller/first-bootstrap-upgrade" },
  );
  const detail = await api.operator.deployment(deployment.id);
  const selections = controlPlaneSelections(controlPlaneJobInput(detail));
  expect(detail.environment.acceptedDeploymentId).toBeNull();
  expect(detail.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(detail.deployment.controlPlaneSnapshot?.previousArtifact.id).toBe(
    fixture.previous.artifactId,
  );
  expect(detail.deployment.controlPlaneSnapshot?.priorChartArtifact.id).toBe(
    fixture.priorChart.artifactId,
  );
  expect(detail.deployment.controlPlaneSnapshot?.priorSelectionManaged).toBe(
    true,
  );
  expect(() =>
    requireExactControlPlaneSource(
      bootstrappedSource,
      selections.prior.selection,
    ),
  ).not.toThrow();
  expect(() =>
    requireExactControlPlaneSource(bootstrappedSource, {
      ...selections.prior.selection,
      parameters: {},
    }),
  ).toThrow("Prior control-plane source");
  await api.operator.cancel(deployment.id);
});

test("real PG+HTTP control-plane intent resumes the same native Job across executor replacement and advances only its own acceptance", async () => {
  const deployment = await api.operator.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
  );
  await deliveryRequest(
    `deployments/${encodeURIComponent(deployment.id)}/claim`,
    DeploymentDetailSchema,
    {},
  );
  let native: ReturnType<typeof DeliveryJobReceiptSchema.parse> | undefined;
  let starts = 0;
  const run: typeof runDeliveryJob = async (
    request,
    checkpoint,
    continuation,
  ) => {
    const input = ControlPlaneJobInputSchema.parse(request.input);
    const manifest = deliveryJobManifest(request);
    expect(request.recipe).toBe("control-plane");
    if (native === undefined) {
      expect(continuation?.createIfAbsent).toBe(true);
      starts++;
      native = DeliveryJobReceiptSchema.parse({
        namespace: manifest.metadata?.namespace,
        name: manifest.metadata?.name,
        uid: crypto.randomUUID(),
        specFingerprint:
          manifest.metadata?.annotations?.[
            "delivery.shepherdjerred.com/fingerprint"
          ],
        requestId: deployment.id,
      });
      for (const [key, value] of Object.entries({
        DELIVERY_JOB_NAMESPACE: native.namespace,
        DELIVERY_JOB_NAME: native.name,
        DELIVERY_JOB_UID: native.uid,
        DELIVERY_JOB_FINGERPRINT: native.specFingerprint,
      }))
        vi.stubEnv(key, value);
      expect(await admitPlatformNativeJob(request)).toEqual(native);
      await checkpoint(native);
      throw new Error(
        "Executor replaced while independent native Job continues",
      );
    }
    expect(continuation).toEqual({
      createIfAbsent: false,
      expectedReceipt: native,
    });
    expect(manifest.metadata?.name).toBe(native.name);
    expect(
      manifest.metadata?.annotations?.[
        "delivery.shepherdjerred.com/fingerprint"
      ],
    ).toBe(native.specFingerprint);
    await checkpoint(native);
    return {
      adapter: "control-plane",
      previousArtifactId: input.snapshot.previousArtifact.id,
      nextArtifactId: input.snapshot.nextArtifact.id,
      chartArtifactId: input.snapshot.chartArtifact.id,
      nativeJobUID: native.uid,
      argoRequestId: deliveryOperationId(`${deployment.id}:control-plane`),
      argoOperationId: crypto.randomUUID(),
    };
  };
  await expect(executeControlPlaneWithJob(deployment.id, run)).rejects.toThrow(
    "Executor replaced",
  );
  const checkpoint = await fixture.delivery.detail(deployment.id);
  expect(checkpoint.deployment.status).toBe("running");
  expect(checkpoint.environment.acceptedDeploymentId).toBeNull();
  expect(
    checkpoint.stages.find((stage) => stage.key === "control-plane")?.message,
  ).toBe(JSON.stringify(native));
  const evidence = await executeControlPlaneWithJob(deployment.id, run);
  expect(starts).toBe(1);
  await finishDelivery(deployment.id, { status: "succeeded", evidence });
  const accepted = await fixture.delivery.detail(deployment.id);
  expect(accepted.environment.acceptedDeploymentId).toBe(deployment.id);
  expect(accepted.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(accepted.environment.observedVersionSetRevisionId).toBeNull();
  expect(accepted.deployment.controlPlaneSnapshot?.nextArtifact.id).toBe(
    fixture.next.artifactId,
  );
  expect(await cluster.database.workerVersion.count()).toBe(0);
  expect(await cluster.database.platformLock.count()).toBe(0);
}, 60_000);
