import { beforeAll, expect, test } from "vitest";
import { App } from "cdk8s";
import type { Chart } from "cdk8s";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAllDocuments, stringify } from "yaml";
import { z } from "zod";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import { applyOrdinaryDeliveryImageBindings } from "@shepherdjerred/homelab/cdk8s/src/ordinary-delivery-image-bindings.ts";
import {
  attachDockerHubPullSecrets,
  prepareDockerHubPullSecrets,
} from "@shepherdjerred/homelab/cdk8s/src/dockerhub-pull-secrets.ts";
import { createTrackerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/tracker.ts";
import { createGlitterBoysLauncherChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/glitter-boys-launcher.ts";
import { ORDINARY_DELIVERY_ENVIRONMENTS } from "homelab/src/delivery-target-policy.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";
import { createDeliveryControlPlaneChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery-control-plane.ts";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import {
  bindChartImageDependencies,
  chartValidationValues,
} from "homelab/scripts/helm/helm-delivery-publication.ts";
import { imageRegistry } from "@shepherdjerred/version-catalog/image-registry";

const pipelines = new URL(
  "../../../../../../delivery/registrations/",
  import.meta.url,
);
const PipelineSchema = z.object({
  namespace: z.string(),
  artifactParameters: z.record(z.string(), z.string()),
});
/**
 * The shared-site proxy's v1 registration is retired (X4); its catalog
 * successor binds the same selected image, so the chart is checked here.
 */
const CATALOG_ONLY_BINDINGS: Readonly<Record<string, unknown>> = {
  "s3-static-sites": {
    namespace: "s3-static-sites",
    artifactParameters: {
      "delivery.images.caddy-s3proxy": "image:caddy-s3proxy",
    },
  },
};
const ManifestSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(z.object({ image: z.string() })),
        initContainers: z.array(z.object({ image: z.string() })).optional(),
        imagePullSecrets: z.array(z.object({ name: z.string() })).optional(),
      }),
    }),
  }),
});
let app: App;
function observeChartDependency(image: string, observed: Set<string>) {
  if (!image.startsWith("docker.io/shepherdjerred/caddy-s3proxy")) return;
  expect(image).toMatch(
    /^docker\.io\/shepherdjerred\/caddy-s3proxy(?::[\w.-]+)?@sha256:[a-f0-9]{64}$/u,
  );
  observed.add(image);
}

beforeAll(async () => {
  app = new App();
  await setupCharts(app);
});

test("external Helm dependencies retain their namespace reader after Delivery image binding", () => {
  const apps = app.charts.find((chart) => chart.node.id === "apps");
  if (apps === undefined) throw new Error("Missing root Applications chart");
  const resources = z
    .array(
      z
        .object({
          kind: z.string(),
          metadata: z.object({ name: z.string() }).loose(),
        })
        .loose(),
    )
    .parse(apps.toJson());
  expect(
    resources.find(
      (resource) =>
        resource.kind === "Application" &&
        resource.metadata.name === "prometheus",
    ),
  ).toMatchObject({
    spec: {
      destination: { namespace: "prometheus" },
      source: {
        helm: {
          valuesObject: {
            global: {
              imagePullSecrets: [{ name: "dockerhub-pull-prometheus" }],
            },
            prometheus: {
              prometheusSpec: {
                containers: expect.arrayContaining([
                  expect.objectContaining({
                    name: "authenticated-gateway",
                    image:
                      '{{ required `Delivery requires image:caddy-s3proxy` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "caddy-s3proxy") }}',
                  }),
                ]),
              },
            },
          },
        },
      },
    },
  });
  const readers = resources.filter(
    (resource) =>
      resource.kind === "OnePasswordItem" &&
      resource.metadata.name === "dockerhub-pull-prometheus",
  );
  expect(readers).toHaveLength(1);
  expect(readers[0]).toMatchObject({
    metadata: { name: "dockerhub-pull-prometheus", namespace: "prometheus" },
    type: "kubernetes.io/dockerconfigjson",
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/ngzmppq52zm7sii6ato2mv3sbi",
    },
  });
});

/** Render an active fixture for prepared services without changing their source activation. */
function activeChart(name: string): Chart {
  if (!["tracker", "glitter-boys-launcher", "delivery"].includes(name)) {
    const chart = app.charts.find((entry) => entry.node.id === name);
    if (chart === undefined) throw new Error(`Missing ordinary chart ${name}`);
    return chart;
  }
  const fixture = new App();
  resetProbeRegistry();
  const image = `0.0.1@sha256:${"f".repeat(64)}`;
  const chart =
    name === "delivery"
      ? createDeliveryChart(fixture, {
          image: `docker.io/shepherdjerred/delivery@sha256:${"f".repeat(64)}`,
          serviceItemId: "service-item",
        })
      : name === "tracker"
        ? createTrackerChart(
            fixture,
            `docker.io/shepherdjerred/tracker@sha256:${"f".repeat(64)}`,
          )
        : createGlitterBoysLauncherChart(
            fixture,
            { schemaVersion: 1, stage: "active" },
            image,
          );
  applyOrdinaryDeliveryImageBindings(fixture);
  prepareDockerHubPullSecrets(fixture);
  attachDockerHubPullSecrets(fixture);
  return chart;
}

async function render(chart: Chart, values: readonly string[]) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "ordinary-delivery-helm-"),
  );
  try {
    await mkdir(path.join(directory, "templates"));
    await Bun.write(
      path.join(directory, "Chart.yaml"),
      `apiVersion: v2\nname: ${chart.node.id}\nversion: 1.0.0\n`,
    );
    const workerPool = z
      .object({ delivery: z.object({ workerPool: z.string().optional() }) })
      .parse(chartValidationValues(chart.node.id)).delivery.workerPool;
    await Bun.write(
      path.join(directory, "values.yaml"),
      stringify({ delivery: { workerPool } }),
    );
    await Bun.write(
      path.join(directory, "templates/workloads.yaml"),
      bindChartImageDependencies(
        z
          .array(z.unknown())
          .parse(chart.toJson())
          .map((object) => stringify(object))
          .join("---\n"),
        Object.fromEntries(
          imageRegistry.images.map((image) => [
            `shepherdjerred/${image.name}`,
            `sha256:${"f".repeat(64)}`,
          ]),
        ),
      ),
    );
    const child = Bun.spawn(
      [
        "helm",
        "template",
        chart.node.id,
        directory,
        ...values.flatMap((value) => ["--set-string", value]),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) throw new Error(stderr);
    return parseAllDocuments(stdout).map((document) => {
      const object: unknown = document.toJSON();
      return object;
    });
  } finally {
    await rm(directory, { recursive: true });
  }
}

test.each(Object.keys(ORDINARY_DELIVERY_ENVIRONMENTS))(
  "%s renders every reviewed selected image, including init containers and private readers",
  async (name) => {
    const input: unknown =
      CATALOG_ONLY_BINDINGS[name] ??
      (await Bun.file(
        new URL(
          name === "arcade"
            ? "arcade.pipeline.json"
            : `ordinary/${name}/pipeline.json`,
          pipelines,
        ),
      ).json());
    const pipeline = PipelineSchema.parse(input);
    const bindings = Object.entries(pipeline.artifactParameters);
    const selected = new Map(
      bindings.map(([parameter, component], index) => [
        component,
        {
          parameter,
          image: `docker.io/shepherdjerred/${component.slice("image:".length)}@sha256:${String(index + 1).repeat(64)}`,
        },
      ]),
    );
    const chart = activeChart(name);
    const manifests = await render(
      chart,
      [...selected.values()].map(
        (binding) => `${binding.parameter}=${binding.image}`,
      ),
    );
    const containers: string[] = [];
    const dependencies = new Set<string>();
    for (const manifest of manifests) {
      const parsed = ManifestSchema.safeParse(manifest);
      if (!parsed.success) continue;
      const pod = parsed.data.spec.template.spec;
      const firstParty = [
        ...pod.containers,
        ...(pod.initContainers ?? []),
      ].filter((container) =>
        container.image.startsWith("docker.io/shepherdjerred/"),
      );
      if (firstParty.length === 0) continue;
      expect(pod.imagePullSecrets).toContainEqual({
        name: `dockerhub-pull-${pipeline.namespace}`,
      });
      for (const container of firstParty) {
        if (name === "arcade" && parsed.data.metadata.name === "arcade-edge") {
          expect(container.image).toBe(
            `docker.io/shepherdjerred/caddy-s3proxy@sha256:${"f".repeat(64)}`,
          );
          observeChartDependency(container.image, dependencies);
          continue;
        }
        expect(
          [...selected.values()].map((binding) => binding.image),
        ).toContain(container.image);
        containers.push(container.image);
      }
    }
    for (const binding of selected.values())
      expect(containers).toContain(binding.image);
    expect(dependencies.size).toBe(name === "arcade" ? 1 : 0);
    await expect(render(chart, [])).rejects.toThrow("Delivery requires image");
  },
);

test("central shared Activity roles and init containers use the selected image; retained hosts use the separate pool", async () => {
  const chart = activeChart("temporal");
  const image = `docker.io/shepherdjerred/temporal-worker@sha256:${"a".repeat(64)}`;
  const manifests = await render(chart, [
    `delivery.images.temporal-worker=${image}`,
  ]);
  const observed = new Set<string>();
  const labels = z.object({
    metadata: z.object({ name: z.string() }),
    spec: z.object({
      template: z.object({
        metadata: z.object({ labels: z.record(z.string(), z.string()) }),
      }),
    }),
  });
  let initContainers = 0;
  const dependencies = new Set<string>();
  for (const manifest of manifests) {
    const parsed = ManifestSchema.safeParse(manifest);
    if (!parsed.success) continue;
    const role = labels.parse(manifest);
    const workflow =
      role.spec.template.metadata.labels["worker-family"] ===
      "central-workflows";
    const pod = parsed.data.spec.template.spec;
    for (const container of [
      ...pod.containers,
      ...(pod.initContainers ?? []),
    ]) {
      observeChartDependency(container.image, dependencies);
      if (
        !container.image.startsWith("docker.io/shepherdjerred/temporal-worker")
      )
        continue;
      if (!workflow) {
        expect(container.image).toBe(image);
        observed.add(role.metadata.name);
      }
    }
    if (!workflow)
      initContainers += (pod.initContainers ?? []).filter(
        (container) => container.image === image,
      ).length;
  }
  expect(observed.size).toBeGreaterThan(10);
  expect([...observed]).toContain("temporal-temporal-agent-worker");
  expect(initContainers).toBeGreaterThan(0);
  expect(dependencies.size).toBe(1);
});

test("application rollbacks never render the separately owned control-plane roles, whose chart selects its original exact image", async () => {
  resetProbeRegistry();
  const fixture = new App();
  createTemporalChart(fixture);
  const applicationChart = fixture.charts.find(
    (entry) => entry.node.id === "temporal",
  );
  if (applicationChart === undefined) throw new Error("Central chart missing");
  expect(JSON.stringify(applicationChart.toJson())).not.toContain(
    '"component":"delivery-worker"',
  );
  const chart = createDeliveryControlPlaneChart(fixture, {
    image: `docker.io/shepherdjerred/delivery@sha256:${"d".repeat(64)}`,
    serviceItemId: "service-item",
    executorItemId: "executor-item",
    argocdItemId: "argo-item",
    platformRegistryItemId: "ngzmppq52zm7sii6ato2mv3sbi",
    platformArgocdItemId: "issued-platform-item",
  });
  applyOrdinaryDeliveryImageBindings(fixture);
  const candidate = `docker.io/shepherdjerred/temporal-worker@sha256:${"b".repeat(64)}`;
  const controlPlane = `docker.io/shepherdjerred/temporal-worker:2.0.0-1@sha256:${"c".repeat(64)}`;
  const manifests = await render(chart, [
    `delivery.images.temporal-worker=${candidate}`,
    `delivery.images.delivery-control-plane=${controlPlane}`,
  ]);
  const observed = new Set<string>();
  let steadyCpu = 0;
  let steadyMemory = 0;
  for (const manifest of manifests) {
    const role = z
      .object({
        spec: z.object({
          template: z.object({
            metadata: z.object({ labels: z.record(z.string(), z.string()) }),
            spec: z.object({
              containers: z.array(z.object({ image: z.string() })),
            }),
          }),
        }),
      })
      .safeParse(manifest);
    if (!role.success) continue;
    const component = role.data.spec.template.metadata.labels["component"];
    if (
      !component ||
      ![
        "delivery-worker",
        "delivery-platform-worker",
        "delivery-workflows",
      ].includes(component)
    )
      continue;
    expect(
      role.data.spec.template.spec.containers.map(
        (container) => container.image,
      ),
    ).toEqual([controlPlane]);
    observed.add(component);
    const runtime = z
      .object({
        spec: z.object({
          template: z.object({
            spec: z.object({
              automountServiceAccountToken: z.boolean(),
              containers: z.array(
                z.object({
                  env: z.array(
                    z.object({
                      name: z.string(),
                      valueFrom: z.unknown().optional(),
                    }),
                  ),
                  resources: z.object({
                    requests: z.object({ cpu: z.string(), memory: z.string() }),
                  }),
                }),
              ),
            }),
          }),
        }),
      })
      .parse(manifest).spec.template.spec;
    if (component !== undefined) {
      for (const container of runtime.containers) {
        steadyCpu += Number(
          z
            .string()
            .regex(/^\d+m$/u)
            .parse(container.resources.requests.cpu)
            .slice(0, -1),
        );
        steadyMemory += Number(
          z
            .string()
            .regex(/^\d+Mi$/u)
            .parse(container.resources.requests.memory)
            .slice(0, -2),
        );
      }
    }
    if (component === "delivery-workflows") {
      expect(runtime.automountServiceAccountToken).toBe(false);
      expect(
        runtime.containers[0]?.env.map((value) => value.name).sort(),
      ).toEqual([
        "ENVIRONMENT",
        "TEMPORAL_ADDRESS",
        "TEMPORAL_METRICS_ADDRESS",
        "TEMPORAL_NAMESPACE",
        "TEMPORAL_WORKER_ROLE",
        "TZ",
      ]);
      expect(
        runtime.containers[0]?.env.some(
          (value) => value.valueFrom !== undefined,
        ),
      ).toBe(false);
    }
  }
  expect([...observed].sort()).toEqual([
    "delivery-platform-worker",
    "delivery-worker",
    "delivery-workflows",
  ]);
  expect({ cpuMillis: steadyCpu, memoryMiB: steadyMemory }).toEqual({
    cpuMillis: 300,
    memoryMiB: 768,
  });
});
