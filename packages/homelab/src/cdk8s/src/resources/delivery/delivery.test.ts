import { App, Chart } from "cdk8s";
import { beforeEach, describe, expect, it } from "vitest";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import {
  deliveryActivation,
  deliveryExecutorActivation,
} from "./activation.ts";
import { z } from "zod";
import { createAppsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/apps.ts";
import { assertDeliveryRootPreservesSelection } from "@shepherdjerred/homelab/scripts/argocd/argocd-delivery.ts";
import { createArcadeChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/arcade.ts";
import { createDeliveryJobs } from "./jobs.ts";
import { createDeliveryWorker } from "./worker.ts";
import { createWoodpeckerStepNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/step-network-policy.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";

beforeEach(resetProbeRegistry);
const activation = {
  image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
  serviceItemId: "service-item",
  executorItemId: "executor-item",
};
it("keeps the journal API available until its migrating replacement is ready", () => {
  const resources = createDeliveryChart(new App(), activation).toJson();
  expect(
    resources.find((resource) => resource.kind === "Deployment"),
  ).toMatchObject({
    spec: {
      replicas: 1,
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: { maxSurge: 1, maxUnavailable: 0 },
      },
      template: {
        spec: {
          initContainers: [{ name: "migrate" }],
          containers: [
            {
              name: "delivery",
              readinessProbe: { httpGet: { path: "/readyz" } },
            },
          ],
        },
      },
    },
  });
});
const Resources = z.array(
  z
    .object({
      kind: z.string(),
      metadata: z.object({
        name: z.string(),
        labels: z.record(z.string(), z.string()).optional(),
        annotations: z.record(z.string(), z.string()).optional(),
      }),
      spec: z.unknown().optional(),
    })
    .loose(),
);
const SecretEnvironmentEntry = z.object({
  name: z.string(),
  valueFrom: z
    .object({ secretKeyRef: z.object({ name: z.string(), key: z.string() }) })
    .optional(),
});
function platformCapabilityChart() {
  return new Chart(new App(), "issued-platform-capability", {
    namespace: "temporal",
  });
}

it("root applies preserve delegated fields and the pilot image has an explicit Helm binding", () => {
  const root = createAppsApp(new Chart(new App(), "apps"));
  expect(() =>
    assertDeliveryRootPreservesSelection(root.toJson()),
  ).not.toThrow();
  const app = new App();
  createArcadeChart(app);
  const chart = app.node.findChild("arcade");
  if (!(chart instanceof Chart)) throw new TypeError("Arcade chart is missing");
  const resources = JSON.stringify(chart.toJson());
  expect(resources).toContain(
    JSON.stringify(
      '{{ required `Delivery requires image` (get (.Values.delivery | default dict) "image") }}',
    ),
  );
});

describe("Delivery worker capability isolation", () => {
  it("requires the genuinely issued platform account locator before projecting platform capability", () => {
    expect(() =>
      createDeliveryWorker(
        platformCapabilityChart(),
        {
          ...activation,
          argocdItemId: "ordinary-argo",
          platformRegistryItemId: "registry",
        },
        "temporal-server",
      ),
    ).toThrow("issued dedicated");
    const chart = platformCapabilityChart();
    createDeliveryWorker(
      chart,
      {
        ...activation,
        argocdItemId: "ordinary-argo",
        platformRegistryItemId: "registry",
        platformArgocdItemId: "issued-platform-argocd",
      },
      "temporal-server",
    );
    const items = z
      .array(
        z.object({
          kind: z.string(),
          metadata: z.object({
            name: z.string(),
            namespace: z.string().optional(),
          }),
          spec: z.object({ itemPath: z.string().optional() }).optional(),
        }),
      )
      .parse(chart.toJson())
      .filter((item) => item.kind === "OnePasswordItem");
    expect(
      items.find((item) => item.metadata.name === "delivery-platform-argocd"),
    ).toMatchObject({
      metadata: { namespace: "delivery-platform-jobs" },
      spec: {
        itemPath:
          "vaults/v64ocnykdqju4ui6j6pua56xw4/items/issued-platform-argocd",
      },
    });
    expect(JSON.stringify(items)).not.toContain("ga3ma76q6vw2bxeyvkqj4xaucy");
  });
  it("keeps the pilot tokenless and gives enabled worker proof only its restricted registry-only namespace", () => {
    for (const enabled of [false, true]) {
      resetProbeRegistry();
      const chart = new Chart(new App(), "worker-capability", {
        namespace: "temporal",
      });
      createDeliveryWorker(
        chart,
        {
          ...activation,
          argocdItemId: "argo-item",
          ...(enabled
            ? { workerRegistryItemId: "ngzmppq52zm7sii6ato2mv3sbi" }
            : {}),
        },
        "temporal-server",
      );
      const resources = Resources.parse(chart.toJson());
      const deployment = resources.find(
        (resource) => resource.kind === "Deployment",
      );
      const pod = z
        .object({
          template: z.object({
            spec: z.object({
              automountServiceAccountToken: z.boolean(),
              serviceAccountName: z.string(),
              containers: z.array(
                z.object({ env: z.array(SecretEnvironmentEntry) }),
              ),
            }),
          }),
        })
        .parse(deployment?.spec).template.spec;
      expect(pod.automountServiceAccountToken).toBe(enabled);
      const registryEnvironment = pod.containers
        .flatMap((container) => container.env)
        .filter((entry) => entry.name === "DOCKERHUB_READ_CONFIG_JSON");
      const registryItem = resources.find(
        (resource) =>
          resource.kind === "OnePasswordItem" &&
          resource.metadata.name.includes("delivery-runtime-registry"),
      );
      expect(registryEnvironment).toEqual(
        enabled
          ? [
              {
                name: "DOCKERHUB_READ_CONFIG_JSON",
                valueFrom: {
                  secretKeyRef: {
                    name: registryItem?.metadata.name,
                    key: ".dockerconfigjson",
                  },
                },
              },
            ]
          : [],
      );
      if (enabled)
        expect(registryItem).toMatchObject({
          type: "kubernetes.io/dockerconfigjson",
          spec: {
            itemPath:
              "vaults/v64ocnykdqju4ui6j6pua56xw4/items/ngzmppq52zm7sii6ato2mv3sbi",
          },
        });
      else expect(registryItem).toBeUndefined();
      const namespaces = resources.filter(
        (resource) => resource.kind === "Namespace",
      );
      expect(namespaces.map((namespace) => namespace.metadata.name)).toEqual(
        enabled ? ["delivery-worker-jobs"] : [],
      );
      const text = JSON.stringify(resources);
      expect(text).not.toContain("delivery-platform-jobs");
      expect(text).not.toContain("ci-seaweedfs-credentials");
      expect(text).not.toContain("delivery-root-release");
      if (enabled) {
        expect(text).toContain(
          '"pod-security.kubernetes.io/enforce":"restricted"',
        );
        const items = resources.filter(
          (resource) => resource.kind === "OnePasswordItem",
        );
        expect(
          items
            .map((item) => item.metadata.name)
            .filter((name) => name.startsWith("dockerhub-pull-")),
        ).toEqual(["dockerhub-pull-delivery-worker-jobs"]);
        expect(pod.serviceAccountName).toBe("delivery-worker-job-controller");
      }
    }
  });
});

describe("Delivery infrastructure", () => {
  it("grants dedicated static activation keys only after storage bootstrap", () => {
    for (const storageReady of [false, true]) {
      resetProbeRegistry();
      const chart = new Chart(new App(), "worker");
      createDeliveryWorker(
        chart,
        {
          ...activation,
          argocdItemId: "argo-item",
          ...(storageReady ? { staticStorageItemId: "static-item" } : {}),
        },
        "temporal-server",
      );
      const resources = Resources.parse(chart.toJson());
      const worker = resources.find(
        (resource) => resource.kind === "Deployment",
      );
      const env = z
        .object({
          template: z.object({
            spec: z.object({
              containers: z.array(
                z.object({
                  env: z.array(SecretEnvironmentEntry),
                }),
              ),
            }),
          }),
        })
        .parse(worker?.spec)
        .template.spec.containers.flatMap((container) => container.env);
      const staticKeys = env.filter((entry) =>
        entry.name.startsWith("DELIVERY_SITE_ACTIVATOR_"),
      );
      expect(staticKeys.map((entry) => entry.name).sort()).toEqual(
        storageReady
          ? [
              "DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID",
              "DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY",
            ]
          : [],
      );
      expect(
        staticKeys.every(
          (entry) => entry.valueFrom?.secretKeyRef.key === entry.name,
        ),
      ).toBe(true);
      expect(
        env.some((entry) => entry.name.startsWith("SEAWEEDFS_SITES_")),
      ).toBe(false);
      expect(
        env.some((entry) =>
          entry.name.startsWith("DELIVERY_ARCHIVE_PUBLISHER_"),
        ),
      ).toBe(false);
    }
  });
  it("grants the npm channel token only once its item is issued", () => {
    for (const issued of [false, true]) {
      resetProbeRegistry();
      const chart = new Chart(new App(), "worker");
      createDeliveryWorker(
        chart,
        {
          ...activation,
          argocdItemId: "argo-item",
          ...(issued ? { npmChannelItemId: "npm-item" } : {}),
        },
        "temporal-server",
      );
      const tokens = JSON.stringify(chart.toJson()).match(/"NPM_TOKEN"/gu);
      expect(tokens?.length ?? 0).toBe(issued ? 2 : 0);
    }
  });
  it("confines Delivery API egress to publication, CI image registration, and the two archive producers", () => {
    const chart = new Chart(new App(), "ci-network");
    createWoodpeckerStepNetworkPolicy(chart);
    const policy = z
      .array(
        z.object({
          spec: z.object({
            podSelector: z
              .object({
                matchLabels: z.record(z.string(), z.string()).optional(),
                matchExpressions: z
                  .array(
                    z.object({
                      key: z.string(),
                      operator: z.string(),
                      values: z.array(z.string()).optional(),
                    }),
                  )
                  .optional(),
              })
              .loose(),
            egress: z.unknown(),
          }),
        }),
      )
      .parse(chart.toJson())
      .find(
        (item) =>
          item.spec.podSelector.matchExpressions?.some((expression) =>
            expression.values?.includes("delivery-publish"),
          ) === true,
      );
    expect(policy?.spec.podSelector.matchExpressions).toEqual([
      {
        key: "ci.sjer.red/step-key",
        operator: "In",
        values: [
          "images",
          "ci-base-refresh",
          "ci-playwright-refresh",
          "helm-push",
          "delivery-publish",
          "scout-site-archives",
          "trmnl-plugin-archives",
        ],
      },
    ]);
    expect(policy?.spec.egress).toEqual([
      {
        to: [
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "delivery" },
            },
            podSelector: { matchLabels: { app: "delivery" } },
          },
        ],
        ports: [{ port: 7353, protocol: "TCP" }],
      },
    ]);
  });
});

describe("Delivery execution and service bootstrap", () => {
  it("keeps disposable stage Pods tokenless and controller grants confined to their own namespace", () => {
    const chart = new Chart(new App(), "job-contract", {
      namespace: "temporal",
    });
    createDeliveryJobs(chart, "worker", "ngzmppq52zm7sii6ato2mv3sbi");
    const resources = z
      .array(
        z.object({
          kind: z.string(),
          metadata: z.object({
            name: z.string(),
            namespace: z.string().optional(),
          }),
          rules: z.unknown().optional(),
          automountServiceAccountToken: z.boolean().optional(),
        }),
      )
      .parse(chart.toJson());
    expect(
      resources.find(
        (item) =>
          item.kind === "ServiceAccount" &&
          item.metadata.name === "delivery-stage",
      ),
    ).toMatchObject({
      metadata: { namespace: "delivery-worker-jobs" },
      automountServiceAccountToken: false,
    });
    const role = resources.find((item) => item.kind === "Role");
    expect(role?.metadata.namespace).toBe("delivery-worker-jobs");
    const rules = z
      .array(
        z.object({
          apiGroups: z.array(z.string()),
          resources: z.array(z.string()),
          verbs: z.array(z.string()),
        }),
      )
      .parse(role?.rules);
    expect(
      rules.map(
        (rule) => `${rule.apiGroups.join(",")}:${rule.resources.join(",")}`,
      ),
    ).toEqual(["batch:jobs", ":pods", ":pods/log"]);
    expect(
      Object.fromEntries(
        rules.map((rule) => [rule.resources.join(","), [...rule.verbs].sort()]),
      ),
    ).toEqual({
      jobs: ["create", "get"],
      pods: ["get", "list"],
      "pods/log": ["get"],
    });
  });
  it("requires a PG image while retaining every issued scoped capability registration", () => {
    expect(deliveryActivation()).toMatchObject({
      image: "docker.io/shepherdjerred/delivery:delivery-recipe",
      serviceItemId: "ahbp4izt7fibvwdjwd4ffhiime",
    });
    expect(deliveryExecutorActivation()).toMatchObject({
      argocdItemId: "w7rrmm6v2agx7jk4qjsaybxaau",
      observerItemId: "irdujpdyylkem65wnr4ibw2ggq",
      platformArgocdItemId: "orpriiyv36sxmybxe3fg4szdxq",
      staticStorageItemId: "l5c76kuxgqckt3xc7pmman6l4u",
      staticCacheItemId: "la7gkfl5eqtxiiv2hq3qujx2gi",
      workerRegistryItemId: "ngzmppq52zm7sii6ato2mv3sbi",
      minecraftRegistryItemId: "ngzmppq52zm7sii6ato2mv3sbi",
      platformRegistryItemId: "ngzmppq52zm7sii6ato2mv3sbi",
      forumReaderItemId: "6x57e27b4jb7fxgyx2nmhhcldq",
      forumObserverItemId: "es5ddbihz4qeylhjt2x2iemvzi",
      trmnlArchiveReaderItemId: "542onhpijguqgaukmyvbujbu74",
      trmnlKeyItemId: "p7th6tqeel7k2sm47mrrto7oca",
    });
    expect(createDeliveryChart(new App(), undefined).toJson()).toMatchObject([
      { kind: "ConfigMap", data: { active: "false" } },
    ]);
  });
  it("uses the existing HTTPS operator ingress and keeps machine API traffic separately authenticated", () => {
    const resources = Resources.parse(
      createDeliveryChart(new App(), activation).toJson(),
    );
    // Under transition rendering `delivery-data` owns the cluster.
    const database = resources.find(
      (resource) => resource.kind === "postgresql",
    );
    expect(database !== undefined).toBe(!transitionRendering());
    const monitor = resources.find(
      (resource) => resource.kind === "ServiceMonitor",
    );
    expect(monitor?.spec).toMatchObject({
      endpoints: [{ port: "http", path: "/metrics" }],
      selector: { matchLabels: { app: "delivery" } },
    });
    expect(
      resources.some((resource) => resource.kind === "PrometheusRule"),
    ).toBe(true);
    const services = resources.filter(
      (resource) => resource.kind === "Service",
    );
    expect(services.map((service) => service.metadata.name).sort()).toEqual([
      "delivery",
    ]);
    const policy = resources.find(
      (resource) =>
        resource.kind === "NetworkPolicy" &&
        z
          .object({
            podSelector: z.object({
              matchLabels: z.object({ app: z.literal("delivery") }),
            }),
          })
          .safeParse(resource.spec).success,
    );
    const spec = z
      .object({
        ingress: z.array(
          z.object({
            from: z.array(z.unknown()),
            ports: z.array(z.object({ port: z.number() })),
          }),
        ),
      })
      .parse(policy?.spec);
    expect(
      spec.ingress
        .flatMap((rule) => rule.ports)
        .every((port) => port.port === 7353),
    ).toBe(true);
    expect(JSON.stringify(spec.ingress)).toContain(
      '"values":["images","ci-base-refresh","ci-playwright-refresh","helm-push","delivery-publish","scout-site-archives","trmnl-plugin-archives"]',
    );
    expect(JSON.stringify(spec.ingress)).toContain(
      '"kubernetes.io/metadata.name":"woodpecker-ci"',
    );
    expect(
      resources.find((resource) => resource.kind === "Ingress"),
    ).toMatchObject({
      metadata: {
        name: "delivery-operator-ingress",
        annotations: { "tailscale.com/tags": "tag:delivery" },
      },
      spec: {
        ingressClassName: "tailscale",
        defaultBackend: {
          service: { name: "delivery", port: { number: 7353 } },
        },
        tls: [{ hosts: ["delivery"] }],
      },
    });
    const deployment = resources.find(
      (resource) => resource.kind === "Deployment",
    );
    const pod = z
      .object({
        template: z.object({
          spec: z.object({
            automountServiceAccountToken: z.literal(false),
            containers: z.array(
              z.object({
                name: z.string(),
                env: z.array(
                  z.object({ name: z.string(), value: z.string().optional() }),
                ),
              }),
            ),
          }),
        }),
      })
      .parse(deployment?.spec).template.spec;
    expect(pod.containers.map((container) => container.name)).toEqual([
      "delivery",
    ]);
    expect(
      pod.containers
        .flatMap((container) => container.env)
        .some(({ name }) => name.startsWith("TS_")),
    ).toBe(false);
    expect(
      resources.filter((resource) => resource.kind === "PersistentVolumeClaim"),
    ).toEqual([]);
  });
});
