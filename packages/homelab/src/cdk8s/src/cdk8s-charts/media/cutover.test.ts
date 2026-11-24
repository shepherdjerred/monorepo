import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createMediaChart } from "./media.ts";
import {
  getRegisteredBackendProbes,
  getRegisteredPublicProbes,
  resetProbeRegistry,
} from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { publicHostname, tailnetService } from "homelab/src/platform-model.ts";

const MetadataEntries = z.record(z.string(), z.string());
const Resource = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    labels: MetadataEntries.optional(),
    annotations: MetadataEntries.optional(),
  }),
  spec: z.unknown().optional(),
});
const DeploymentTemplate = z.object({
  template: z.object({ spec: z.unknown() }),
});
beforeEach(resetProbeRegistry);
async function fixture() {
  const app = new App();
  await createMediaChart(app);
  return z.array(Resource).parse(app.charts[0]?.toJson());
}

test("exact nine legacy writers stop while Plex, qBit, Streambot and Media remain running", async () => {
  const resources = await fixture();
  const deployments = resources.filter(
    (resource) => resource.kind === "Deployment",
  );
  const replicas = Object.fromEntries(
    deployments.map((resource) => [
      resource.metadata.name,
      z.object({ replicas: z.number() }).parse(resource.spec).replicas,
    ]),
  );
  expect(replicas).toEqual({
    "media-bazarr": 0,
    "media-maintainerr": 0,
    "media-prowlarr": 0,
    "media-radarr": 0,
    "media-recyclarr": 0,
    "media-seerr": 0,
    "media-sonarr": 0,
    "media-tautulli": 0,
    "media-whisperbridge": 0,
    "media-plex": 1,
    "media-qbittorrent": 1,
    "media-streambot": 1,
    "media-media-api": 1,
    "media-media-network": 1,
    "media-media-files": 1,
  });
});

test("all fifteen persistent claims preserve identity, capacity, storage class and existing backup policy", async () => {
  const resources = await fixture();
  const claims = resources.filter(
    (resource) => resource.kind === "PersistentVolumeClaim",
  );
  const capacities = Object.fromEntries(
    claims.map((claim) => {
      const spec = z
        .object({
          accessModes: z.array(z.string()),
          volumeMode: z.literal("Filesystem"),
          storageClassName: z.string(),
          resources: z.object({ requests: z.object({ storage: z.string() }) }),
        })
        .parse(claim.spec);
      expect(spec.accessModes).toEqual(["ReadWriteOnce"]);
      const largeLibrary = spec.storageClassName === "zfs-hdd";
      expect(claim.metadata.labels).toEqual({
        "velero.io/backup": largeLibrary ? "disabled" : "enabled",
        "velero.io/exclude-from-backup": largeLibrary ? "true" : "false",
      });
      return [
        claim.metadata.name,
        [spec.storageClassName, spec.resources.requests.storage],
      ];
    }),
  );
  expect(capacities).toEqual({
    "bazarr-pvc": ["zfs-ssd", "8Gi"],
    "maintainerr-pvc": ["zfs-ssd", "8Gi"],
    "prowlarr-pvc": ["zfs-ssd", "8Gi"],
    "radarr-pvc": ["zfs-ssd", "8Gi"],
    "recyclarr-pvc": ["zfs-ssd", "8Gi"],
    "seerr-pvc": ["zfs-ssd", "8Gi"],
    "sonarr-pvc": ["zfs-ssd", "8Gi"],
    "tautulli-pvc": ["zfs-ssd", "8Gi"],
    "plex-pvc": ["zfs-ssd", "64Gi"],
    "qbittorrent-pvc": ["zfs-ssd", "32Gi"],
    "streambot-state-pvc": ["zfs-ssd", "1Gi"],
    "streambot-subs-cache-pvc": ["zfs-ssd", "2Gi"],
    "plex-movies-hdd-pvc": ["zfs-hdd", "8192Gi"],
    "plex-tv-hdd-pvc": ["zfs-hdd", "6144Gi"],
    "qbittorrent-hdd-pvc": ["zfs-hdd", "2048Gi"],
  });
  expect(
    resources.find((resource) => resource.kind === "postgresql"),
  ).toMatchObject({ metadata: { labels: { "velero.io/backup": "enabled" } } });
  for (const name of ["media-bazarr-providers", "recyclarr-config"])
    expect(
      resources.some(
        (resource) =>
          resource.kind === "ConfigMap" && resource.metadata.name === name,
      ),
    ).toBe(true);
});

test.each([
  ["media-tautulli", "tautulli-pvc", "/migration/tautulli"],
  ["media-seerr", "seerr-pvc", "/migration/seerr"],
])(
  "only the Files role mounts the retained %s claim read-only at CSI and in the container",
  async (writer, claim, path) => {
    const resources = await fixture();
    const legacyWriter = resources.find(
      (resource) => resource.metadata.name === writer,
    );
    expect(
      legacyWriter?.metadata.annotations?.["argocd.argoproj.io/sync-wave"] ??
        "0",
    ).toBe("0");
    const PodStorage = z.object({
      securityContext: z
        .object({
          fsGroup: z.number(),
          fsGroupChangePolicy: z.string(),
        })
        .optional(),
      volumes: z.array(
        z.object({
          name: z.string(),
          persistentVolumeClaim: z
            .object({
              claimName: z.string(),
              readOnly: z.boolean().optional(),
            })
            .optional(),
        }),
      ),
      containers: z.array(
        z.object({
          volumeMounts: z.array(
            z.object({
              name: z.string(),
              mountPath: z.string(),
              readOnly: z.boolean().optional(),
            }),
          ),
        }),
      ),
    });
    for (const name of [
      "media-media-api",
      "media-media-network",
      "media-media-files",
    ]) {
      const resource = resources.find(
        (candidate) => candidate.metadata.name === name,
      );
      const pod = PodStorage.parse(
        DeploymentTemplate.parse(resource?.spec).template.spec,
      );
      const history = pod.volumes.filter(
        (volume) => volume.persistentVolumeClaim?.claimName === claim,
      );
      if (name !== "media-media-files") {
        expect(history).toEqual([]);
        continue;
      }
      expect(history).toHaveLength(1);
      expect(history[0]?.persistentVolumeClaim).toEqual({
        claimName: claim,
        readOnly: true,
      });
      expect(
        resource?.metadata.annotations?.["argocd.argoproj.io/sync-wave"],
      ).toBe("3");
      expect(pod.securityContext).toEqual({
        fsGroup: 1000,
        fsGroupChangePolicy: "Always",
      });
      expect(pod.containers).toHaveLength(1);
      const mounts = pod.containers.flatMap(
        (container) => container.volumeMounts,
      );
      expect(mounts).toContainEqual({
        name: history[0]?.name,
        mountPath: path,
        readOnly: true,
      });
      for (const [normalClaim, mountPath, readOnly] of [
        ["plex-movies-hdd-pvc", "/data/movies", false],
        ["plex-tv-hdd-pvc", "/data/tv", false],
        ["qbittorrent-hdd-pvc", "/downloads", true],
      ] as const) {
        const volume = pod.volumes.find(
          (candidate) =>
            candidate.persistentVolumeClaim?.claimName === normalClaim,
        );
        expect(volume?.persistentVolumeClaim?.readOnly).toBe(false);
        const mount = mounts.find(
          (candidate) => candidate.name === volume?.name,
        );
        expect(mount?.mountPath).toBe(mountPath);
        expect(mount?.readOnly ?? false).toBe(readOnly);
      }
    }
  },
);

test("retired ingresses and dead probes are absent while the exact existing Seerr binding now serves Media", async () => {
  const resources = await fixture();
  const ingressNames = resources
    .filter((resource) => resource.kind === "Ingress")
    .map((resource) => resource.metadata.name)
    .sort();
  expect(ingressNames).toEqual([
    "media-media-api-ingress-ingress",
    "media-plex-tailscale-ingress-ingress",
    "media-qbittorrent-tailscale-ingress-ingress",
  ]);
  expect(
    getRegisteredBackendProbes()
      .filter((probe) => probe.namespace === "media")
      .map((probe) => probe.serviceName)
      .sort(),
  ).toEqual(
    [
      "media-api",
      "media-plex-service",
      "media-qbittorrent-service",
      "streambot-web",
    ].sort(),
  );
  expect(
    getRegisteredPublicProbes().filter(
      (probe) => probe.fqdn === "seerr.sjer.red",
    ),
  ).toEqual([
    {
      namespace: "media",
      serviceName: "media-api",
      fqdn: "seerr.sjer.red",
      module: "http_2xx",
      path: "/readyz",
    },
  ]);
  expect(
    resources.find(
      (resource) => resource.metadata.name === "media-seerr-cf-tunnel",
    ),
  ).toMatchObject({
    kind: "TunnelBinding",
    metadata: { finalizers: ["cfargotunnel.com/finalizer"] },
    subjects: [
      { kind: "Service", name: "media-api", spec: { fqdn: "seerr.sjer.red" } },
    ],
  });
  expect(publicHostname("seerr.sjer.red")).toEqual({
    hostname: "seerr.sjer.red",
    namespace: "media",
    service: "media-api",
  });
  expect(tailnetService("media").origin).toBe(
    "https://media.tailnet-1a49.ts.net",
  );
});

test("API and network worker share canonical callbacks and narrowly admit the actual cloudflared pod", async () => {
  const resources = await fixture();
  for (const name of ["media-media-api", "media-media-network"]) {
    const resource = resources.find(
      (candidate) => candidate.metadata.name === name,
    );
    const { containers } = z
      .object({
        containers: z.array(
          z.object({
            env: z.array(
              z.object({ name: z.string(), value: z.string().optional() }),
            ),
          }),
        ),
      })
      .parse(DeploymentTemplate.parse(resource?.spec).template.spec);
    expect(containers[0]?.env).toContainEqual({
      name: "PUBLIC_ORIGIN",
      value: "https://seerr.sjer.red",
    });
  }
  const policy = resources.find(
    (resource) => resource.metadata.name === "media-media-api-netpol",
  );
  expect(policy?.spec).toMatchObject({
    ingress: [
      {
        from: [
          {
            namespaceSelector: {
              matchLabels: {
                "kubernetes.io/metadata.name": "cloudflare-operator-system",
              },
            },
            podSelector: {
              matchLabels: {
                "cfargotunnel.com/app": "cloudflared",
                "cfargotunnel.com/tunnel": "homelab-tunnel",
              },
            },
          },
        ],
        ports: [{ port: 7352, protocol: "TCP" }],
      },
      {
        from: [
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
            },
          },
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
            },
          },
        ],
        ports: [{ port: 7352, protocol: "TCP" }],
      },
    ],
  });
});
