import { App, Chart, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  EnvValue,
  PersistentVolumeClaim,
  Probe,
} from "cdk8s-plus-31";
import { beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  dnsEgressRule,
  tailscaleIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  getRegisteredBackendProbes,
  resetProbeRegistry,
} from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { LinuxServerApp, type LinuxServerAppProps } from "./linuxserver-app.ts";

const Manifest = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
});
const Container = z.looseObject({
  name: z.string(),
  image: z.string().optional(),
  env: z.array(z.looseObject({ name: z.string() })).optional(),
  ports: z.array(z.object({ containerPort: z.number() })).optional(),
  volumeMounts: z.array(z.object({ name: z.string(), mountPath: z.string() })),
  securityContext: z.record(z.string(), z.unknown()),
  resources: z.looseObject({}).optional(),
  readinessProbe: z.looseObject({}).optional(),
  livenessProbe: z.looseObject({}).optional(),
  startupProbe: z.looseObject({}).optional(),
});
const DeploymentManifest = z.looseObject({
  metadata: z.looseObject({
    annotations: z.record(z.string(), z.string()),
  }),
  spec: z.looseObject({
    replicas: z.number(),
    revisionHistoryLimit: z.number(),
    strategy: z.looseObject({ type: z.string() }),
    template: z.object({
      metadata: z.looseObject({
        labels: z.record(z.string(), z.string()),
        annotations: z.record(z.string(), z.string()).optional(),
      }),
      spec: z.looseObject({
        securityContext: z.looseObject({ fsGroup: z.number().optional() }),
        containers: z.array(Container).length(1),
        initContainers: z.array(Container).optional(),
      }),
    }),
  }),
});

// A claim must be listed in the backup policy, so the fixtures borrow real
// ones rather than widen the policy: Prowlarr's, and Syncthing's pair.
const base: LinuxServerAppProps = {
  name: "prowlarr",
  image: "ghcr.io/linuxserver/example:1",
  port: 9696,
  fsGroup: false,
  resources: {},
  claims: [
    {
      claim: "prowlarr-pvc",
      volumeId: "prowlarr-volume",
      storage: Size.gibibytes(8),
      path: "/config",
    },
  ],
};

function render(
  props:
    | Partial<LinuxServerAppProps>
    | ((chart: Chart) => Partial<LinuxServerAppProps>) = {},
  namespace = "media",
) {
  const chart = new Chart(new App(), namespace, {
    namespace,
    disableResourceNameHashes: true,
  });
  const app = new LinuxServerApp(chart, "app", {
    ...base,
    ...(typeof props === "function" ? props(chart) : props),
  });
  const manifests = z.array(Manifest).parse(chart.toJson());
  const deployment = DeploymentManifest.parse(
    manifests.find((manifest) => manifest.kind === "Deployment"),
  );
  const [container] = deployment.spec.template.spec.containers;
  if (container === undefined) throw new Error("no app container");
  return {
    app,
    manifests,
    identities: manifests.map(
      (manifest) => `${manifest.kind}/${manifest.metadata.name}`,
    ),
    of: (kind: string) =>
      manifests.filter((manifest) => manifest.kind === kind),
    deployment,
    container,
  };
}

beforeEach(resetProbeRegistry);

describe("LinuxServerApp workload", () => {
  test("renders a Deployment, its config claim and a Service, named after the app", () => {
    const { identities, of, app } = render();
    expect(identities).toEqual([
      "Deployment/media-prowlarr",
      "PersistentVolumeClaim/prowlarr-pvc",
      "Service/media-prowlarr-service",
    ]);
    expect(of("PersistentVolumeClaim")[0]).toMatchObject({
      spec: { resources: { requests: { storage: "8Gi" } } },
    });
    expect(of("Service")[0]).toMatchObject({
      spec: {
        ports: [{ port: 9696 }],
        selector: { "cdk8s.io/metadata.addr": expect.any(String) },
      },
    });
    expect(app.claims).toHaveLength(1);
    expect(app.policies).toEqual([]);
    expect(getRegisteredBackendProbes()).toEqual([]);
  });

  test("is a single recreated replica carrying the LinuxServer exemptions", () => {
    const { deployment, container } = render();
    expect(deployment.spec.replicas).toBe(1);
    expect(deployment.spec.strategy.type).toBe("Recreate");
    expect(deployment.spec.revisionHistoryLimit).toBe(3);
    expect(deployment.metadata.annotations).toEqual({
      "ignore-check.kube-linter.io/run-as-non-root":
        "LinuxServer.io images run as root internally",
      "ignore-check.kube-linter.io/no-read-only-root-fs":
        "LinuxServer.io images require writable filesystem",
    });
    expect(container).toMatchObject({
      image: "ghcr.io/linuxserver/example:1",
      ports: [{ containerPort: 9696 }],
      env: [
        { name: "TZ", value: "America/Los_Angeles" },
        { name: "PUID", value: "1000" },
        { name: "PGID", value: "1000" },
      ],
      securityContext: {
        runAsUser: 0,
        runAsGroup: 0,
        runAsNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [{ name: "pvc-prowlarr-pvc", mountPath: "/config" }],
    });
  });

  test("leaves volume ownership, probes and resources alone unless told", () => {
    const { deployment, container } = render();
    expect(deployment.spec.template.spec.securityContext.fsGroup).toBe(
      undefined,
    );
    expect(deployment.spec.template.metadata.annotations).toBeUndefined();
    expect(container.resources).toBeUndefined();
    expect(container.readinessProbe).toBeUndefined();
    expect(container.livenessProbe).toBeUndefined();
    // cdk8s-plus gives a container with a port a TCP startup probe of its own.
    expect(container.startupProbe).toEqual({
      failureThreshold: 3,
      tcpSocket: { port: 9696 },
    });
  });

  test("fsGroup, resources, probes, pod metadata and the revision history are stated per app", () => {
    const { deployment, container } = render({
      fsGroup: true,
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
        memory: { request: Size.mebibytes(256), limit: Size.mebibytes(768) },
      },
      probes: { readiness: Probe.fromTcpSocket() },
      podMetadata: {
        labels: { app: "prowlarr" },
        annotations: { checksum: "abc" },
      },
      revisionHistoryLimit: 5,
    });
    expect(deployment.spec.template.spec.securityContext.fsGroup).toBe(1000);
    expect(deployment.spec.revisionHistoryLimit).toBe(5);
    expect(deployment.spec.template.metadata.labels).toMatchObject({
      app: "prowlarr",
    });
    expect(deployment.spec.template.metadata.annotations).toEqual({
      checksum: "abc",
    });
    expect(container.resources).toEqual({
      requests: { cpu: "50m", memory: "256Mi" },
      limits: { cpu: "1000m", memory: "768Mi" },
    });
    expect(container.readinessProbe).toMatchObject({
      tcpSocket: { port: 9696 },
    });
    expect(container.livenessProbe).toBeUndefined();
  });

  test("owned claims come first, then the extension's mounts, then shared claims", () => {
    const { identities, container, app } = render(
      (chart) => ({
        name: "syncthing",
        claims: [
          {
            claim: "syncthing-config",
            volumeId: "syncthing-volume",
            storage: Size.gibibytes(8),
            path: "/config",
          },
          {
            claim: "syncthing-data",
            volumeId: "syncthing-data-volume",
            storage: Size.gibibytes(256),
            path: "/sync",
          },
        ],
        extend: ([config]) => {
          if (config === undefined) throw new Error("no config volume");
          return { volumeMounts: [{ path: "/also-config", volume: config }] };
        },
        sharedMounts: [
          {
            volumeId: "library-volume",
            claim: new PersistentVolumeClaim(chart, "library", {
              metadata: { name: "library" },
              storage: Size.gibibytes(1),
            }),
            path: "/library",
          },
        ],
      }),
      "syncthing",
    );
    expect(identities).toEqual([
      "PersistentVolumeClaim/library",
      "Deployment/syncthing",
      "PersistentVolumeClaim/syncthing-config",
      "PersistentVolumeClaim/syncthing-data",
      "Service/syncthing-syncthing-service",
    ]);
    expect(container.volumeMounts).toEqual([
      { name: "pvc-syncthing-config", mountPath: "/config" },
      { name: "pvc-syncthing-data", mountPath: "/sync" },
      { name: "pvc-syncthing-config", mountPath: "/also-config" },
      { name: "pvc-library", mountPath: "/library" },
    ]);
    expect(app.claims.map((owned) => owned.claim.name)).toEqual([
      "syncthing-config",
      "syncthing-data",
    ]);
  });

  test("an extension adds init containers and environment, and its resources render after the claims", () => {
    const { identities, deployment, container } = render((chart) => ({
      extend: ([config]) => {
        if (config === undefined) throw new Error("no config volume");
        new ConfigMap(chart, "extra", { metadata: { name: "extra" } });
        return {
          init: [
            {
              name: "prepare",
              image: "example",
              resources: {},
              volumeMounts: [{ path: "/config", volume: config }],
            },
          ],
          envVariables: {
            TZ: EnvValue.fromValue(""),
            EXTRA: EnvValue.fromValue("1"),
          },
        };
      },
    }));
    expect(identities).toEqual([
      "Deployment/media-prowlarr",
      "PersistentVolumeClaim/prowlarr-pvc",
      "ConfigMap/extra",
      "Service/media-prowlarr-service",
    ]);
    const [init] = deployment.spec.template.spec.initContainers ?? [];
    expect(init).toMatchObject({
      name: "prepare",
      volumeMounts: [{ name: "pvc-prowlarr-pvc", mountPath: "/config" }],
    });
    // An init container is rendered as given: no LinuxServer environment.
    expect(init?.env).toBeUndefined();
    expect(container.env).toEqual([
      { name: "TZ", value: "" },
      { name: "PUID", value: "1000" },
      { name: "PGID", value: "1000" },
      { name: "EXTRA", value: "1" },
    ]);
  });
});

describe("LinuxServerApp exposure", () => {
  test("a tailnet host is an Ingress on the Service with a blackbox probe", () => {
    const { identities, of } = render({ tailscale: { host: "prowlarr" } });
    expect(identities.at(-1)).toBe(
      "Ingress/media-prowlarr-tailscale-ingress-ingress",
    );
    const [ingress] = of("Ingress");
    expect(ingress?.metadata.labels).toBeUndefined();
    expect(ingress?.["spec"]).toEqual({
      ingressClassName: "tailscale",
      defaultBackend: {
        service: { name: "media-prowlarr-service", port: { number: 9696 } },
      },
      tls: [{ hosts: ["prowlarr"] }],
    });
    expect(getRegisteredBackendProbes()).toMatchObject([
      { namespace: "media", serviceName: "media-prowlarr-service", port: 9696 },
    ]);
  });

  test("a proxy class labels the Ingress", () => {
    const { of } = render({
      tailscale: { host: "prowlarr", proxyClass: "medium" },
    });
    expect(of("Ingress")[0]?.metadata.labels).toEqual({
      "tailscale.com/proxy-class": "medium",
    });
  });

  test("policies select the namespace and render last, typed by their directions", () => {
    const { app, identities, of } = render({
      tailscale: { host: "prowlarr" },
      policies: [
        { name: "app-ingress-netpol", ingress: [tailscaleIngressRule()] },
        { name: "app-egress-netpol", egress: [dnsEgressRule()] },
      ],
    });
    expect(identities.slice(-3)).toEqual([
      "Ingress/media-prowlarr-tailscale-ingress-ingress",
      "NetworkPolicy/app-ingress-netpol",
      "NetworkPolicy/app-egress-netpol",
    ]);
    expect(of("NetworkPolicy").map((policy) => policy["spec"])).toMatchObject([
      { podSelector: {}, policyTypes: ["Ingress"] },
      { podSelector: {}, policyTypes: ["Egress"] },
    ]);
    expect(app.policies).toHaveLength(2);
  });
});
