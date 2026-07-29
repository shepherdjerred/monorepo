import { describe, expect, it } from "bun:test";
import { Chart, Size, Testing } from "cdk8s";
import { PersistentVolumeClaim } from "cdk8s-plus-31";
import { z } from "zod";
import { createQBitTorrentDeployment } from "./qbittorrent.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const HAPROXY_IMAGE = `docker.io/library/haproxy:${versions["library/haproxy"]}`;

const EnvSchema = z
  .object({
    name: z.string(),
    value: z.string().optional(),
  })
  .loose();

const ProbeSchema = z
  .object({
    failureThreshold: z.number(),
    httpGet: z
      .object({
        path: z.string(),
        port: z.number(),
        scheme: z.string(),
      })
      .optional(),
    periodSeconds: z.number(),
  })
  .loose();

const ContainerSchema = z
  .object({
    name: z.string(),
    image: z.string(),
    env: z.array(EnvSchema).optional(),
    ports: z
      .array(
        z.object({
          containerPort: z.number(),
          name: z.string().optional(),
          protocol: z.string().optional(),
        }),
      )
      .optional(),
    resources: z
      .object({
        limits: z.object({ cpu: z.string(), memory: z.string() }),
        requests: z.object({ cpu: z.string(), memory: z.string() }),
      })
      .optional(),
    securityContext: z
      .object({
        allowPrivilegeEscalation: z.boolean(),
        capabilities: z
          .object({
            drop: z.array(z.string()),
          })
          .optional(),
        privileged: z.boolean(),
        readOnlyRootFilesystem: z.boolean(),
        runAsGroup: z.number().optional(),
        runAsNonRoot: z.boolean(),
        runAsUser: z.number().optional(),
        seccompProfile: z
          .object({
            type: z.string(),
          })
          .optional(),
      })
      .optional(),
    startupProbe: ProbeSchema.optional(),
    livenessProbe: ProbeSchema.optional(),
    readinessProbe: ProbeSchema.optional(),
    volumeMounts: z
      .array(
        z.object({
          mountPath: z.string(),
          name: z.string(),
          subPath: z.string().optional(),
        }),
      )
      .optional(),
  })
  .loose();

const DeploymentSchema = z
  .object({
    apiVersion: z.literal("apps/v1"),
    kind: z.literal("Deployment"),
    metadata: z.object({ name: z.literal("media-qbittorrent") }).loose(),
    spec: z
      .object({
        template: z.object({
          spec: z
            .object({
              containers: z.array(ContainerSchema),
              hostAliases: z.array(
                z.object({
                  hostnames: z.array(z.string()),
                  ip: z.string(),
                }),
              ),
              volumes: z.array(
                z
                  .object({
                    name: z.string(),
                    configMap: z
                      .object({
                        name: z.string(),
                      })
                      .optional(),
                  })
                  .loose(),
              ),
            })
            .loose(),
        }),
      })
      .loose(),
  })
  .loose();

const ConfigMapSchema = z
  .object({
    apiVersion: z.literal("v1"),
    kind: z.literal("ConfigMap"),
    metadata: z
      .object({
        name: z.literal("qbittorrent-shelfbridge-relay-config"),
      })
      .loose(),
    data: z.object({
      "haproxy.cfg": z.string(),
    }),
  })
  .loose();

const ServiceSchema = z
  .object({
    kind: z.literal("Service"),
    spec: z.object({
      ports: z.array(
        z.object({
          port: z.number(),
        }),
      ),
    }),
  })
  .loose();

const ResourceIdentitySchema = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
  }),
});

function synthesizeQbittorrent(): unknown[] {
  const app = Testing.app();
  const chart = new Chart(app, "media", {
    namespace: "media",
    disableResourceNameHashes: true,
  });
  const downloads = new PersistentVolumeClaim(chart, "downloads", {
    storage: Size.gibibytes(1),
  });
  createQBitTorrentDeployment(chart, { downloads });
  return z.array(z.unknown()).parse(Testing.synth(chart));
}

const manifests = synthesizeQbittorrent();
function findManifest(kind: string, name: string): unknown {
  return manifests.find((manifest) => {
    const identity = ResourceIdentitySchema.safeParse(manifest);
    return (
      identity.success &&
      identity.data.kind === kind &&
      identity.data.metadata.name === name
    );
  });
}

const deployment = DeploymentSchema.parse(
  findManifest("Deployment", "media-qbittorrent"),
);
const relayConfigMap = ConfigMapSchema.parse(
  findManifest("ConfigMap", "qbittorrent-shelfbridge-relay-config"),
);

function getContainer(name: string): z.infer<typeof ContainerSchema> {
  return ContainerSchema.parse(
    deployment.spec.template.spec.containers.find(
      (container) => container.name === name,
    ),
  );
}

function getEnvValue(
  container: z.infer<typeof ContainerSchema>,
  name: string,
): string {
  return z
    .string()
    .parse(container.env?.find((variable) => variable.name === name)?.value);
}

describe("qBittorrent ShelfBridge relay", () => {
  it("routes the ShelfBridge hostname to the WireGuard-side relay", () => {
    expect(deployment.spec.template.spec.hostAliases).toEqual([
      {
        hostnames: ["media-shelfbridge-service"],
        ip: "10.154.174.240",
      },
    ]);

    const gluetun = getContainer("gluetun");
    expect(getEnvValue(gluetun, "WIREGUARD_ADDRESSES")).toBe(
      "10.154.174.240/32,fd7d:76ee:e68f:a993:af57:e79c:b39d:9dde/128",
    );
    expect(getEnvValue(gluetun, "FIREWALL_OUTBOUND_SUBNETS")).toBe(
      "10.96.0.0/12",
    );
  });

  it("runs a pinned and hardened HAProxy sidecar", () => {
    const relay = getContainer("shelfbridge-relay");

    expect(relay.image).toBe(HAPROXY_IMAGE);
    expect(relay.ports).toEqual([
      { containerPort: 8787, name: "webseed-relay", protocol: "TCP" },
      { containerPort: 8404, name: "relay-health", protocol: "TCP" },
    ]);
    expect(relay.resources).toEqual({
      limits: { cpu: "100m", memory: "64Mi" },
      requests: { cpu: "10m", memory: "32Mi" },
    });
    expect(relay.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      privileged: false,
      readOnlyRootFilesystem: true,
      runAsGroup: 99,
      runAsNonRoot: true,
      runAsUser: 99,
      seccompProfile: { type: "RuntimeDefault" },
    });
    expect(relay.volumeMounts).toEqual([
      {
        mountPath: "/usr/local/etc/haproxy/haproxy.cfg",
        name: "configmap-qbittorrent-shelfbridge-relay-config",
        subPath: "haproxy.cfg",
      },
    ]);
    expect(deployment.spec.template.spec.volumes).toContainEqual({
      configMap: { name: "qbittorrent-shelfbridge-relay-config" },
      name: "configmap-qbittorrent-shelfbridge-relay-config",
    });
  });

  it("reports ready only when the fixed ShelfBridge backend is healthy", () => {
    const relay = getContainer("shelfbridge-relay");

    expect(relay.startupProbe).toEqual({
      failureThreshold: 30,
      httpGet: { path: "/health", port: 8404, scheme: "HTTP" },
      periodSeconds: 5,
    });
    expect(relay.livenessProbe).toEqual({
      failureThreshold: 3,
      httpGet: { path: "/health", port: 8404, scheme: "HTTP" },
      periodSeconds: 30,
    });
    expect(relay.readinessProbe).toEqual({
      failureThreshold: 3,
      httpGet: { path: "/health", port: 8404, scheme: "HTTP" },
      periodSeconds: 10,
    });

    const config = relayConfigMap.data["haproxy.cfg"];
    expect(config).toContain("frontend shelfbridge_webseed\n  bind :8787");
    expect(config).toContain(
      "server shelfbridge 10.109.78.226:8787 check inter 5s fall 3 rise 2",
    );
    expect(config).toContain(
      "monitor fail if { nbsrv(shelfbridge_backend) lt 1 }",
    );
    expect(config.match(/^\s*server\s+/gm)).toHaveLength(1);
    expect(config).not.toContain("server-template");
  });

  it("does not expose either relay port through a Kubernetes Service", () => {
    const exposedPorts = manifests.flatMap((manifest) => {
      const service = ServiceSchema.safeParse(manifest);
      return service.success
        ? service.data.spec.ports.map(({ port }) => port)
        : [];
    });

    expect(exposedPorts.toSorted((left, right) => left - right)).toEqual([
      8080, 17_871,
    ]);
  });

  it("keeps qBittorrent hard-bound to wg0 in committed config", async () => {
    const config = await Bun.file(
      `${import.meta.dir}/../configs/qbittorrent/qBittorrent.conf`,
    ).text();
    const interfaceLines = config
      .split("\n")
      .filter((line) => line.startsWith(String.raw`Session\Interface`));

    expect(interfaceLines).toEqual([
      String.raw`Session\Interface=wg0`,
      String.raw`Session\InterfaceAddress=`,
      String.raw`Session\InterfaceName=wg0`,
    ]);
  });
});
