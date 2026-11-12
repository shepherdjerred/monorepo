import { App, Chart, Size, Testing } from "cdk8s";
import { Cpu, DeploymentStrategy } from "cdk8s-plus-31";
import { beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  dnsEgressRule,
  tailscaleIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  getRegisteredBackendProbes,
  resetProbeRegistry,
} from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import {
  FirstPartyWebService,
  type FirstPartyWebServiceProps,
} from "./web-service.ts";

const Manifest = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
});
const Container = z.looseObject({
  name: z.string(),
  ports: z
    .array(z.object({ name: z.string(), containerPort: z.number() }))
    .optional(),
  volumeMounts: z.array(z.object({ name: z.string(), mountPath: z.string() })),
  livenessProbe: z.looseObject({}).optional(),
  readinessProbe: z.looseObject({}).optional(),
  startupProbe: z.looseObject({}).optional(),
});
const DeploymentManifest = z.looseObject({
  metadata: z.looseObject({
    labels: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.looseObject({
    replicas: z.number(),
    revisionHistoryLimit: z.number(),
    strategy: z.looseObject({ type: z.string() }),
    template: z.object({
      metadata: z.object({ labels: z.record(z.string(), z.string()) }),
      spec: z.looseObject({
        containers: z.array(Container).length(1),
        initContainers: z.array(Container).optional(),
        volumes: z.array(z.looseObject({ name: z.string() })),
      }),
    }),
  }),
});

const resources = {
  cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
  memory: { request: Size.mebibytes(64), limit: Size.mebibytes(128) },
};
const server = {
  image: "example",
  securityContext: restrictedContainer(1000),
  resources,
};

// A claim must be listed in the backup policy, so the data tests borrow a real
// one rather than widen the policy for a fixture.
const DATA_NAMESPACE = "alert-dashboard";
const data = {
  id: "alert-dashboard-data",
  storage: Size.gibibytes(8),
  path: "/data",
};

const base: FirstPartyWebServiceProps = {
  name: "widget",
  port: 8080,
  probes: { live: "/healthz", ready: "/readyz" },
  containers: () => ({ server }),
  policies: [],
};

function render(
  props:
    | Partial<FirstPartyWebServiceProps>
    | ((chart: Chart) => Partial<FirstPartyWebServiceProps>) = {},
  namespace = "widgets",
) {
  const chart = new Chart(new App(), "widgets", {
    namespace,
    disableResourceNameHashes: true,
  });
  const web = new FirstPartyWebService(chart, "widget-web-service", {
    ...base,
    ...(typeof props === "function" ? props(chart) : props),
  });
  const manifests = z.array(Manifest).parse(Testing.synth(chart));
  return {
    web,
    manifests,
    identities: manifests.map(
      (manifest) => `${manifest.kind}/${manifest.metadata.name}`,
    ),
    of: (kind: string) =>
      manifests.filter((manifest) => manifest.kind === kind),
    deployment: DeploymentManifest.parse(
      manifests.find((manifest) => manifest.kind === "Deployment"),
    ),
  };
}

beforeEach(resetProbeRegistry);

describe("FirstPartyWebService workload", () => {
  test("an internal-only service is a Deployment, a Service and a ServiceMonitor", () => {
    const { identities, of } = render();
    expect(identities).toEqual([
      "Deployment/widgets-widget",
      "Service/widgets-widget-service",
      "ServiceMonitor/widget-service-monitor",
    ]);
    expect(of("Service")[0]).toMatchObject({
      metadata: { labels: { app: "widget" } },
      spec: {
        ports: [{ name: "http", port: 8080 }],
        selector: { "cdk8s.io/metadata.addr": expect.any(String) },
      },
    });
    expect(of("ServiceMonitor")[0]).toMatchObject({
      metadata: { namespace: "widgets" },
      spec: {
        endpoints: [{ port: "http", interval: "30s", path: "/metrics" }],
        selector: { matchLabels: { app: "widget" } },
      },
    });
    expect(getRegisteredBackendProbes()).toEqual([]);
  });

  test("the server container takes the service's name, port, probes and a writable /tmp", () => {
    const { deployment } = render({
      probes: {
        live: "/healthz",
        ready: "/readyz",
        startup: { failureThreshold: 18 },
      },
    });
    const { spec } = deployment;
    expect(spec.replicas).toBe(1);
    expect(spec.revisionHistoryLimit).toBe(3);
    expect(spec.strategy.type).toBe("RollingUpdate");
    expect(deployment.metadata.labels).toBeUndefined();
    expect(spec.template.metadata.labels).toMatchObject({ app: "widget" });
    expect(spec.template.spec.containers[0]).toMatchObject({
      name: "widget",
      ports: [{ name: "http", containerPort: 8080 }],
      volumeMounts: [{ name: "tmp", mountPath: "/tmp" }],
      livenessProbe: { httpGet: { path: "/healthz", port: 8080 } },
      readinessProbe: { httpGet: { path: "/readyz", port: 8080 } },
      startupProbe: {
        httpGet: { path: "/healthz", port: 8080 },
        failureThreshold: 18,
      },
    });
    expect(spec.template.spec.volumes).toEqual([{ name: "tmp", emptyDir: {} }]);
  });

  test("Deployment settings and the revision history pass through", () => {
    const { deployment } = render({
      deployment: {
        metadata: { labels: { app: "widget" } },
        strategy: DeploymentStrategy.recreate(),
        securityContext: { fsGroup: 1000 },
      },
      revisionHistoryLimit: 5,
    });
    expect(deployment.metadata.labels).toEqual({ app: "widget" });
    expect(deployment.spec.strategy.type).toBe("Recreate");
    expect(deployment.spec.revisionHistoryLimit).toBe(5);
    expect(deployment.spec.template.spec).toMatchObject({
      securityContext: { fsGroup: 1000 },
    });
  });

  test("a data claim is mounted ahead of /tmp in every container", () => {
    const { deployment, of } = render(
      {
        data,
        containers: () => ({
          init: [{ ...server, name: "migrate" }],
          server,
        }),
      },
      DATA_NAMESPACE,
    );
    expect(of("PersistentVolumeClaim")[0]).toMatchObject({
      metadata: { name: "alert-dashboard-data" },
      spec: { resources: { requests: { storage: "8Gi" } } },
    });
    const mounts = [
      { name: "pvc-alert-dashboard-data", mountPath: "/data" },
      { name: "tmp", mountPath: "/tmp" },
    ];
    const pod = deployment.spec.template.spec;
    expect(pod.initContainers?.map((container) => container.name)).toEqual([
      "migrate",
    ]);
    expect(pod.initContainers?.[0]?.volumeMounts).toEqual(mounts);
    expect(pod.initContainers?.[0]?.ports).toBeUndefined();
    expect(pod.containers[0]?.volumeMounts).toEqual(mounts);
  });

  test("resources created while building the containers render between the Deployment and the claim", () => {
    const { identities } = render(
      (chart) => ({
        data,
        containers: () => {
          onePasswordSecret(chart, "widget-1p", "widget");
          return { server };
        },
      }),
      DATA_NAMESPACE,
    );
    expect(identities.slice(0, 4)).toEqual([
      "Deployment/widgets-widget",
      "OnePasswordItem/widgets-widget-1p",
      "PersistentVolumeClaim/alert-dashboard-data",
      "Service/widgets-widget-service",
    ]);
  });
});

describe("FirstPartyWebService exposure", () => {
  test("Tailscale hosts render in order against the named Service and share one probe", () => {
    const { identities, of } = render({
      serviceName: "widget",
      tailscale: {
        probePath: "/healthz",
        hosts: [
          { id: "widget-ingress", host: "widget" },
          { id: "widget-alt-ingress", host: "gadget" },
        ],
      },
    });
    expect(identities).toEqual([
      "Deployment/widgets-widget",
      "Service/widget",
      "ServiceMonitor/widget-service-monitor",
      "Ingress/widgets-widget-ingress-ingress",
      "Ingress/widgets-widget-alt-ingress-ingress",
    ]);
    expect(of("Ingress").map((ingress) => ingress["spec"])).toEqual(
      ["widget", "gadget"].map((host) => ({
        ingressClassName: "tailscale",
        defaultBackend: { service: { name: "widget", port: { number: 8080 } } },
        tls: [{ hosts: [host] }],
      })),
    );
    expect(getRegisteredBackendProbes()).toMatchObject([
      { serviceName: "widget", port: 8080, path: "/healthz" },
    ]);
  });

  test("a Cloudflare hostname binds the tunnel to the Service", () => {
    const { of } = render({
      cloudflare: {
        id: "widget-cf-tunnel",
        fqdn: "widget.example.com",
        probePath: "/livez",
      },
    });
    expect(of("TunnelBinding")[0]).toMatchObject({
      metadata: { name: "widgets-widget-cf-tunnel" },
      subjects: [
        {
          name: "widgets-widget-service",
          spec: { fqdn: "widget.example.com" },
        },
      ],
    });
  });

  test("policies render last, typed by the directions they give rules for", () => {
    const { web, identities, of } = render({
      tailscale: {
        probePath: "/healthz",
        hosts: [{ id: "widget-ingress", host: "widget" }],
      },
      policies: [
        {
          name: "widget-app-netpol",
          selects: "app",
          ingress: [tailscaleIngressRule([8080])],
          egress: [dnsEgressRule()],
        },
        {
          name: "widget-ingress-netpol",
          selects: "namespace",
          ingress: [],
        },
      ],
    });
    expect(identities.slice(-2)).toEqual([
      "NetworkPolicy/widget-app-netpol",
      "NetworkPolicy/widget-ingress-netpol",
    ]);
    const [app, namespace] = of("NetworkPolicy");
    expect(app?.["spec"]).toMatchObject({
      podSelector: { matchLabels: { app: "widget" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [{ ports: [{ port: 8080, protocol: "TCP" }] }],
    });
    expect(namespace?.["spec"]).toEqual({
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [],
    });
    expect(web.policies).toHaveLength(2);
  });

  test("refuses a chart without a namespace", () => {
    expect(
      () => new FirstPartyWebService(Testing.chart(), "widget-web", base),
    ).toThrow("needs a namespaced chart");
  });
});
