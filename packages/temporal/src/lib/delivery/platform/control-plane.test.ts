import { expect, test, vi } from "vitest";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import { DELIVERY_ROOT_IGNORE_EXPRESSIONS } from "homelab/src/delivery-ownership.ts";
import {
  ControlPlaneJobInputSchema,
  controlPlaneSelections,
  runControlPlaneUpgrade,
  type ControlPlaneEffects,
} from "./control-plane.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { verifyControlPlaneImageCompatibility } from "./control-plane-image.ts";
import {
  CONTROL_PLANE_IMAGE_ABI,
  CONTROL_PLANE_IMAGE_LABEL,
} from "@shepherdjerred/ops-model/delivery-control-plane.ts";

function fixture() {
  const image = ArtifactVersionSchema.parse({
    id: "image/original",
    component: "image:temporal-worker",
    kind: "image",
    uri: "docker.io/shepherdjerred/temporal-worker",
    digest: `sha256:${"a".repeat(64)}`,
    version: "2.0.0-1000001",
    serviceId: "temporal",
    buildId: "temporal/build1",
    sourceRevision: "a".repeat(40),
    createdAt: new Date().toISOString(),
  });
  const chart = (number: number) =>
    ArtifactVersionSchema.parse({
      id: `chart/${String(number)}`,
      component: "chart:delivery-control-plane",
      kind: "chart",
      uri: `https://chartmuseum.tailnet-1a49.ts.net/charts/delivery-control-plane-2.0.0-${String(number)}.tgz`,
      digest: `sha256:${"b".repeat(64)}`,
      version: `2.0.0-${String(number)}`,
      serviceId: "delivery-control-plane",
      buildId: `cp/build${String(number)}`,
      sourceRevision: "b".repeat(40),
      createdAt: new Date().toISOString(),
    });
  const input = ControlPlaneJobInputSchema.parse({
    deploymentId: "cp/request",
    configuration: {},
    snapshot: {
      schema: "delivery-control-plane/v1",
      source: {
        id: "cp/build2",
        sourceRevision: "b".repeat(40),
        repositoryId: 1,
        pipelineNumber: 2,
        ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/2",
      },
      previousArtifact: image,
      nextArtifact: image,
      priorChartArtifact: chart(1),
      priorSelectionManaged: true,
      chartArtifact: chart(2),
    },
  });
  const selections = controlPlaneSelections(input);
  const source = (next: boolean) => {
    const selected = next
      ? selections.next.selection
      : selections.prior.selection;
    return {
      repoURL: selected.repository,
      chart: selected.chart,
      targetRevision: selected.revision,
      helm: {
        parameters: Object.entries(selected.parameters).map(
          ([name, value]) => ({ name, value, forceString: true }),
        ),
      },
    };
  };
  let selected = false;
  const owned = crypto.randomUUID();
  const workload = (next: boolean) => ({
    kind: "Deployment",
    metadata: { name: "delivery-executor", namespace: "temporal" },
    spec: {
      replicas: 1,
      template: {
        metadata: { labels: { component: "delivery-worker" } },
        spec: {
          containers: [
            {
              name: "executor",
              image: `${image.uri}:${image.version}@${image.digest}`,
              readinessProbe: {
                httpGet: { path: next ? "/new-ready" : "/ready", port: 9465 },
              },
            },
          ],
        },
      },
    },
  });
  const app = () => ({
    kind: "Application",
    metadata: {
      name: "delivery-control-plane",
      resourceVersion: "42",
      annotations: {
        "delivery.shepherdjerred.com/environment":
          "delivery-control-plane/prod",
      },
    },
    spec: {
      source: source(selected),
      destination: { namespace: "temporal" },
      syncPolicy: { automated: { enabled: false } },
    },
    status: {
      sync: { status: "Synced", revision: selected ? "2.0.0-2" : "2.0.0-1" },
      health: { status: "Healthy" },
      operationState: {
        phase: "Succeeded",
        finishedAt: new Date().toISOString(),
        syncResult: { revision: "2.0.0-2" },
        operation: {
          info: [
            {
              name: "ci.sjer.red/request-id",
              value: deliveryOperationId(`${input.deploymentId}:control-plane`),
            },
            { name: "ci.sjer.red/operation-id", value: owned },
          ],
        },
      },
      history: [{ id: 2, revision: "2.0.0-2", source: source(true) }],
    },
  });
  const patch = vi.fn(async (application: string) => {
    expect(application).toBe("delivery-control-plane");
    selected = true;
  });
  const effects: ControlPlaneEffects = {
    quiesce: vi.fn(async () => {
      /* Exact native process barrier has separate ownership tests. */
    }),
    assertQuiescent: vi.fn(async () => {
      /* Fresh native barrier assertion has separate tests. */
    }),
    replay: vi.fn(async () => {
      /* Real SDK history replay is covered by the dedicated queue integration. */
    }),
    fence: vi.fn(async () => {
      /* Real PG claim fencing is covered at the API integration boundary. */
    }),
    render: async ({ chart: artifact }) => [
      workload(artifact.id === "chart/2"),
    ],
    read: async (name) =>
      name === "apps"
        ? {
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
          }
        : app(),
    workloads: async () => [workload(selected)],
    pods: async () => [
      {
        metadata: { labels: { component: "delivery-worker" } },
        spec: {
          containers: [
            {
              name: "executor",
              image: `${image.uri}:${image.version}@${image.digest}`,
            },
          ],
        },
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "executor",
              ready: true,
              imageID: image.digest,
              state: { running: {} },
            },
          ],
        },
      },
    ],
    patch,
    sync: vi.fn(async () => {
      /* The injected source observation carries the owned finished native operation. */
    }),
  };
  return { input, effects, patch, image, app, owned };
}

test("different controller image requires immutable supported ABI; retained image still proves original baked source without relabeling", async () => {
  const { input } = fixture();
  const snapshot = structuredClone(input.snapshot);
  const config = (labels?: Record<string, string>) => ({
    os: "linux",
    architecture: "amd64",
    config: {
      Env: [`GIT_SHA=${snapshot.nextArtifact.sourceRevision}`],
      Labels: labels ?? {
        [CONTROL_PLANE_IMAGE_LABEL]: CONTROL_PLANE_IMAGE_ABI,
      },
    },
  });
  const run = vi.fn(async () => ({
    stdout: JSON.stringify({
      "linux/amd64": config(),
      "linux/arm64": { ...config(), architecture: "arm64" },
    }),
    stderr: "",
  }));
  await verifyControlPlaneImageCompatibility(snapshot, run);
  expect(run).toHaveBeenCalledTimes(1);
  snapshot.nextArtifact.digest = `sha256:${"d".repeat(64)}`;
  await verifyControlPlaneImageCompatibility(snapshot, run);
  expect(run).toHaveBeenCalledTimes(2);
  await expect(
    verifyControlPlaneImageCompatibility(snapshot, async () => ({
      stdout: JSON.stringify(config({})),
      stderr: "",
    })),
  ).rejects.toThrow("supported Delivery control-plane ABI");
  await expect(
    verifyControlPlaneImageCompatibility(snapshot, async () => ({
      stdout: JSON.stringify({
        "linux/amd64": config(),
        "linux/arm64": {
          ...config(),
          architecture: "arm64",
          config: { ...config().config, Env: ["GIT_SHA=foreign"] },
        },
      }),
      stderr: "",
    })),
  ).rejects.toThrow("original baked source");
  expect(
    await Bun.file(new URL("../../../../Dockerfile", import.meta.url)).text(),
  ).toContain(
    `LABEL ${CONTROL_PLANE_IMAGE_LABEL}="${CONTROL_PLANE_IMAGE_ABI}"`,
  );
});

test("chart-only control-plane upgrade preserves original image provenance and operates only on its independent Application", async () => {
  const { input, effects, patch, image, owned } = fixture();
  const nativeJobUID = crypto.randomUUID();
  const receipt = await runControlPlaneUpgrade(input, effects, nativeJobUID);
  expect(receipt).toEqual({
    adapter: "control-plane",
    previousArtifactId: image.id,
    nextArtifactId: image.id,
    chartArtifactId: "chart/2",
    nativeJobUID,
    argoRequestId: deliveryOperationId(`${input.deploymentId}:control-plane`),
    argoOperationId: owned,
  });
  expect(patch).toHaveBeenCalledTimes(1);
  expect(effects.fence).toHaveBeenCalledTimes(3);
  expect(effects.quiesce).toHaveBeenCalledTimes(1);
  expect(effects.replay).toHaveBeenCalledTimes(1);
});
test("incompatible candidate replay blocks source selection after the native process barrier", async () => {
  const { input, effects, patch } = fixture();
  effects.replay = async () => {
    throw new Error("Nondeterministic candidate history");
  };
  await expect(
    runControlPlaneUpgrade(input, effects, crypto.randomUUID()),
  ).rejects.toThrow("Nondeterministic");
  expect(effects.quiesce).toHaveBeenCalledTimes(1);
  expect(patch).not.toHaveBeenCalled();
});

test("foreign operations, missing controller Pods and application workloads fail before source mutation", async () => {
  for (const mode of ["operation", "pods", "application"] as const) {
    const { input, effects, patch, app } = fixture();
    if (mode === "operation") {
      const read = effects.read;
      effects.read = async (name) =>
        name === "apps"
          ? await read(name)
          : { ...app(), operation: { sync: { revision: "foreign" } } };
    } else if (mode === "pods") effects.pods = async () => [];
    else {
      const render = effects.render;
      effects.render = async (selection) => {
        const resources = await render(selection);
        return [
          ...resources,
          {
            kind: "Deployment",
            metadata: { name: "ordinary", namespace: "temporal" },
            spec: {
              template: {
                metadata: { labels: { component: "activity-worker" } },
                spec: { containers: [] },
              },
            },
          },
        ];
      };
    }
    await expect(
      runControlPlaneUpgrade(input, effects, crypto.randomUUID()),
    ).rejects.toThrow();
    expect(patch).not.toHaveBeenCalled();
  }
});
