import { describe, expect, it } from "vitest";
import { Chart, Size, Testing } from "cdk8s";
import { PersistentVolumeClaim } from "cdk8s-plus-31";
import { z } from "zod";
import { createQBitTorrentDeployment } from "./qbittorrent.ts";

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
    tcpSocket: z
      .object({
        port: z.number(),
      })
      .optional(),
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
        limits: z.object({ cpu: z.string(), memory: z.string() }).optional(),
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
          metadata: z
            .object({ labels: z.object({ app: z.string() }).loose() })
            .loose(),
          spec: z
            .object({
              containers: z.array(ContainerSchema),
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

const ServiceSchema = z
  .object({
    kind: z.literal("Service"),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z
      .object({
        ports: z.array(
          z.object({
            port: z.number(),
          }),
        ),
        publishNotReadyAddresses: z.boolean().optional(),
      })
      .loose(),
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
const qbittorrentService = ServiceSchema.parse(
  findManifest("Service", "media-qbittorrent-service"),
);
const qbittorrentMetricsService = ServiceSchema.parse(
  findManifest("Service", "media-qbittorrent-metrics-service"),
);

function getContainer(name: string): z.infer<typeof ContainerSchema> {
  return ContainerSchema.parse(
    deployment.spec.template.spec.containers.find(
      (container) => container.name === name,
    ),
  );
}

describe("qBittorrent deployment", () => {
  it("uses the audited resource reservations", () => {
    expect(getContainer("gluetun").resources).toEqual({
      requests: { cpu: "25m", memory: "128Mi" },
    });
    expect(getContainer("qbittorrent").resources).toEqual({
      requests: { cpu: "200m", memory: "4608Mi" },
      limits: { cpu: "2000m", memory: "6144Mi" },
    });
    expect(getContainer("qbittorrent-exporter").resources).toEqual({
      requests: { cpu: "10m", memory: "64Mi" },
    });
  });

  it("labels qBittorrent pods for the dedicated tracker policy", () => {
    expect(deployment.spec.template.metadata.labels.app).toBe("qbittorrent");
  });

  it("contains no retired ShelfBridge workload resources", () => {
    expect(
      deployment.spec.template.spec.containers.map(
        (container) => container.name,
      ),
    ).toEqual(["gluetun", "qbittorrent", "qbittorrent-exporter"]);
    expect(
      deployment.spec.template.spec.volumes.map((volume) => volume.name),
    ).not.toContain("configmap-qbittorrent-shelfbridge-relay-config");
    expect(
      deployment.spec.template.spec.volumes.flatMap((volume) =>
        volume.configMap?.name ? [volume.configMap.name] : [],
      ),
    ).toEqual(["qbittorrent-config"]);
  });

  it("gates WebUI traffic on qBittorrent readiness while keeping metrics discoverable", () => {
    const qbittorrent = getContainer("qbittorrent");

    expect(qbittorrent.startupProbe).toEqual({
      failureThreshold: 90,
      periodSeconds: 10,
      tcpSocket: { port: 8080 },
    });
    expect(qbittorrent.readinessProbe).toEqual({
      failureThreshold: 3,
      periodSeconds: 10,
      tcpSocket: { port: 8080 },
    });
    expect(qbittorrentService.spec.publishNotReadyAddresses).toBeUndefined();
    expect(qbittorrentService.spec.ports.map(({ port }) => port)).toEqual([
      8080,
    ]);
    expect(qbittorrentMetricsService.spec.publishNotReadyAddresses).toBe(true);
    expect(
      qbittorrentMetricsService.spec.ports.map(({ port }) => port),
    ).toEqual([17_871]);
  });

  it("exposes only the qBittorrent WebUI and metrics services", () => {
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
