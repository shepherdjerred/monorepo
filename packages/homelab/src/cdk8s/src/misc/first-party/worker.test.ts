import { App, Chart, Size, Testing } from "cdk8s";
import { Cpu, DeploymentStrategy, Volume } from "cdk8s-plus-31";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  dnsEgressRule,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { BURST_SERVICE_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { FirstPartyWorker, type FirstPartyWorkerProps } from "./worker.ts";

const Manifest = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
});
const Container = z.looseObject({
  name: z.string(),
  volumeMounts: z
    .array(z.object({ name: z.string(), mountPath: z.string() }))
    .optional(),
});
const DeploymentManifest = z.looseObject({
  spec: z.looseObject({
    replicas: z.number(),
    revisionHistoryLimit: z.number().optional(),
    strategy: z.looseObject({ type: z.string() }),
    template: z.object({
      spec: z.looseObject({
        containers: z.array(Container),
        initContainers: z.array(Container).optional(),
        priorityClassName: z.string().optional(),
      }),
    }),
  }),
});

const main = {
  image: "example",
  securityContext: restrictedContainer(1000),
  resources: {
    cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
    memory: { request: Size.mebibytes(64), limit: Size.mebibytes(128) },
  },
};

// A claim must be listed in the backup policy, so the data tests borrow a real
// one rather than widen the policy for a fixture.
const DATA_NAMESPACE = "starlight-karma-bot-prod";
const data = {
  id: "starlight-karma-bot-storage-claim",
  storage: Size.gibibytes(2),
  volumeId: "gadget-volume",
  path: "/data",
};
const metrics = {
  serviceId: "gadget-metrics-service",
  app: "gadget-metrics",
  port: 9464,
  monitorName: "gadget",
};

const base: FirstPartyWorkerProps = {
  name: "gadget",
  containers: () => ({ main }),
  policies: [],
};

function render(
  props:
    | Partial<FirstPartyWorkerProps>
    | ((chart: Chart) => Partial<FirstPartyWorkerProps>) = {},
  namespace = "gadgets",
) {
  const chart = new Chart(new App(), "gadgets", {
    namespace,
    disableResourceNameHashes: true,
  });
  const worker = new FirstPartyWorker(chart, "gadget-worker", {
    ...base,
    ...(typeof props === "function" ? props(chart) : props),
  });
  const manifests = z.array(Manifest).parse(Testing.synth(chart));
  return {
    worker,
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

describe("FirstPartyWorker workload", () => {
  test("a bare worker is one Recreate Deployment and nothing else", () => {
    const { identities, deployment, worker } = render();
    expect(identities).toEqual(["Deployment/gadgets-gadget"]);
    expect(deployment.spec.replicas).toBe(1);
    expect(deployment.spec.strategy.type).toBe("Recreate");
    expect(deployment.spec.revisionHistoryLimit).toBe(3);
    expect(deployment.spec.template.spec.priorityClassName).toBeUndefined();
    expect(worker.service).toBeUndefined();
    expect(worker.serviceMonitor).toBeUndefined();
    expect(worker.dataVolume).toBeUndefined();
    expect(worker.container.name).toBe("main");
  });

  test("Deployment settings, the priority class and the revision history pass through", () => {
    const { deployment } = render({
      deployment: {
        replicas: 0,
        strategy: DeploymentStrategy.rollingUpdate(),
        securityContext: { fsGroup: 1000 },
      },
      priorityClassName: BURST_SERVICE_PRIORITY,
      revisionHistoryLimit: 5,
    });
    expect(deployment.spec.replicas).toBe(0);
    expect(deployment.spec.strategy.type).toBe("RollingUpdate");
    expect(deployment.spec.revisionHistoryLimit).toBe(5);
    expect(deployment.spec.template.spec).toMatchObject({
      securityContext: { fsGroup: 1000 },
      priorityClassName: BURST_SERVICE_PRIORITY,
    });
  });

  test("the revision history can be left at the cdk8s default", () => {
    const { deployment } = render({ revisionHistoryLimit: false });
    expect(deployment.spec.revisionHistoryLimit).toBe(10);
  });

  test("init containers, the main container and sidecars keep their order and mounts", () => {
    const { deployment } = render({
      containers: () => ({
        init: [{ ...main, name: "prepare" }],
        main: { ...main, name: "gadget" },
        sidecars: [
          { ...main, name: "sandbox" },
          { ...main, name: "relay" },
        ],
      }),
    });
    const pod = deployment.spec.template.spec;
    expect(pod.initContainers?.map((container) => container.name)).toEqual([
      "prepare",
    ]);
    expect(pod.containers.map((container) => container.name)).toEqual([
      "gadget",
      "sandbox",
      "relay",
    ]);
  });

  test("a data claim is mounted ahead of the main container's other mounts, and only there", () => {
    const { deployment, of, worker } = render(
      (chart) => ({
        data,
        containers: () => ({
          main: {
            ...main,
            volumeMounts: [
              {
                path: "/scratch",
                volume: Volume.fromEmptyDir(chart, "gadget-scratch", "scratch"),
              },
            ],
          },
          sidecars: [{ ...main, name: "sandbox" }],
        }),
      }),
      DATA_NAMESPACE,
    );
    expect(of("PersistentVolumeClaim")[0]).toMatchObject({
      metadata: { name: "starlight-karma-bot-storage-claim" },
      spec: { resources: { requests: { storage: "2Gi" } } },
    });
    const [first, sidecar] = deployment.spec.template.spec.containers;
    expect(first?.volumeMounts).toEqual([
      { name: "pvc-starlight-karma-bot-storage-claim", mountPath: "/data" },
      { name: "scratch", mountPath: "/scratch" },
    ]);
    expect(sidecar?.volumeMounts).toBeUndefined();
    expect(worker.dataVolume?.claim.name).toBe(
      "starlight-karma-bot-storage-claim",
    );
  });

  test("resources created while building the containers render between the Deployment and the claim", () => {
    const { identities } = render(
      (chart) => ({
        data,
        metrics,
        containers: (deployment) => {
          expect(deployment.name).toBe("gadgets-gadget");
          onePasswordSecret(chart, "gadget-1p", "gadget");
          return { main };
        },
      }),
      DATA_NAMESPACE,
    );
    expect(identities).toEqual([
      "Deployment/gadgets-gadget",
      "OnePasswordItem/gadgets-gadget-1p",
      "PersistentVolumeClaim/starlight-karma-bot-storage-claim",
      "Service/gadgets-gadget-metrics-service",
      "ServiceMonitor/gadget-service-monitor",
    ]);
  });
});

describe("FirstPartyWorker metrics and policies", () => {
  test("the metrics Service is selected by its app label and scraped on its port name", () => {
    const { of, worker } = render({ metrics });
    expect(of("Service")[0]).toMatchObject({
      metadata: {
        name: "gadgets-gadget-metrics-service",
        labels: { app: "gadget-metrics" },
      },
      spec: {
        ports: [{ name: "metrics", port: 9464 }],
        selector: { "cdk8s.io/metadata.addr": expect.any(String) },
      },
    });
    expect(of("ServiceMonitor")[0]).toMatchObject({
      metadata: { name: "gadget-service-monitor", namespace: "gadgets" },
      spec: {
        endpoints: [{ port: "metrics", interval: "30s", path: "/metrics" }],
        selector: { matchLabels: { app: "gadget-metrics" } },
      },
    });
    expect(worker.service?.name).toBe("gadgets-gadget-metrics-service");
  });

  test("the Service name, port name and target port are stated when a worker has them", () => {
    const { of } = render({
      metrics: {
        ...metrics,
        serviceName: "gadget-metrics",
        portName: "ui",
        targetPort: 8081,
      },
    });
    expect(of("Service")[0]).toMatchObject({
      metadata: { name: "gadget-metrics" },
      spec: { ports: [{ name: "ui", port: 9464, targetPort: 8081 }] },
    });
    expect(of("ServiceMonitor")[0]).toMatchObject({
      spec: { endpoints: [{ port: "ui" }] },
    });
  });

  test("policies render last, typed by the directions they give rules for", () => {
    const { identities, of, worker } = render({
      metrics,
      deployment: { podMetadata: { labels: { app: "gadget" } } },
      policies: [
        {
          name: "gadget-ingress-netpol",
          selects: "namespace",
          ingress: [prometheusIngressRule([9464])],
        },
        {
          name: "gadget-egress-netpol",
          selects: "app",
          egress: [dnsEgressRule()],
        },
      ],
    });
    expect(identities.slice(-2)).toEqual([
      "NetworkPolicy/gadget-ingress-netpol",
      "NetworkPolicy/gadget-egress-netpol",
    ]);
    const [ingress, egress] = of("NetworkPolicy");
    expect(ingress?.["spec"]).toMatchObject({
      podSelector: {},
      policyTypes: ["Ingress"],
    });
    expect(egress?.["spec"]).toMatchObject({
      podSelector: { matchLabels: { app: "gadget" } },
      policyTypes: ["Egress"],
    });
    expect(worker.policies).toHaveLength(2);
  });

  test("refuses an app policy for a worker without pod labels", () => {
    expect(() =>
      render({
        policies: [{ name: "gadget-netpol", selects: "app", ingress: [] }],
      }),
    ).toThrow("has no pod labels");
  });

  test("refuses a chart without a namespace", () => {
    expect(
      () => new FirstPartyWorker(Testing.chart(), "gadget-worker", base),
    ).toThrow("needs a namespaced chart");
  });
});
