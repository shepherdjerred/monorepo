import { beforeEach, expect, test } from "vitest";
import { App, Chart, Size } from "cdk8s";
import { PersistentVolumeClaim, Secret } from "cdk8s-plus-31";
import { z } from "zod";
import { createUnifiedMediaApplication } from "./index.ts";
import { mediaImageReference } from "./image.ts";
import { createMediaChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/media/media.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { applyOrdinaryDeliveryImageBindings } from "@shepherdjerred/homelab/cdk8s/src/ordinary-delivery-image-bindings.ts";
import {
  attachDockerHubPullSecrets,
  prepareDockerHubPullSecrets,
} from "@shepherdjerred/homelab/cdk8s/src/dockerhub-pull-secrets.ts";

beforeEach(resetProbeRegistry);
const image = `docker.io/shepherdjerred/media@sha256:${"1".repeat(64)}`;

test("installing Media preserves every existing stack resource", async () => {
  const legacy = new App();
  await createMediaChart(legacy);
  const before = z
    .array(
      z.looseObject({
        kind: z.string(),
        metadata: z.looseObject({ name: z.string() }),
      }),
    )
    .parse(legacy.charts[0]?.toJson());
  resetProbeRegistry();
  const parallel = new App();
  await createMediaChart(
    parallel,
    "docker.io/shepherdjerred/media:delivery-recipe",
  );
  const after = z
    .array(
      z.looseObject({
        kind: z.string(),
        metadata: z.looseObject({ name: z.string() }),
      }),
    )
    .parse(parallel.charts[0]?.toJson());
  for (const resource of before)
    expect(
      after.find(
        (candidate) =>
          candidate.kind === resource.kind &&
          candidate.metadata.name === resource.metadata.name,
      ),
    ).toEqual(resource);
  expect(after.length).toBeGreaterThan(before.length);
});

function resources(selection = image, bindSelection = false) {
  const app = new App();
  const chart = new Chart(app, "media", {
    namespace: "media",
    disableResourceNameHashes: true,
  });
  const claims = {
    movies: new PersistentVolumeClaim(chart, "movies", {
      storage: Size.gibibytes(1),
    }),
    tv: new PersistentVolumeClaim(chart, "tv", { storage: Size.gibibytes(1) }),
    downloads: new PersistentVolumeClaim(chart, "downloads", {
      storage: Size.gibibytes(1),
    }),
  };
  createUnifiedMediaApplication(chart, {
    image: selection,
    claims,
    plex: {
      serviceName: "plex",
      tokenSecret: Secret.fromSecretName(chart, "plex-token", "plex-secret"),
    },
  });
  if (bindSelection) applyOrdinaryDeliveryImageBindings(app);
  prepareDockerHubPullSecrets(app);
  attachDockerHubPullSecrets(app);
  return z
    .array(
      z.object({
        kind: z.string(),
        metadata: z.object({
          name: z.string(),
          labels: z.record(z.string(), z.string()).optional(),
        }),
        spec: z.unknown().optional(),
        rules: z.unknown().optional(),
        subjects: z.unknown().optional(),
      }),
    )
    .parse(chart.toJson());
}

test("all media deployments can pull their private images through the namespace reader secret", () => {
  const manifests = resources();
  expect(
    manifests.find(
      (resource) =>
        resource.kind === "OnePasswordItem" &&
        resource.metadata.name === "dockerhub-pull-media",
    ),
  ).toBeDefined();
  const deployments = manifests.filter(
    (resource) => resource.kind === "Deployment",
  );
  expect(deployments).toHaveLength(3);
  for (const deployment of deployments) {
    expect(deployment.spec).toMatchObject({
      template: {
        spec: { imagePullSecrets: [{ name: "dockerhub-pull-media" }] },
      },
    });
  }
});

test("unpublished media never opens the image gate", () => {
  expect(mediaImageReference(undefined)).toBeUndefined();
  expect(() =>
    mediaImageReference(
      `docker.io/shepherdjerred/media@sha256:${"0".repeat(64)}`,
    ),
  ).toThrow("immutable");
  expect(() => mediaImageReference("latest")).toThrow("immutable");
  expect(mediaImageReference(image)).toBe(image);
  expect(
    mediaImageReference("docker.io/shepherdjerred/media:delivery-recipe"),
  ).toBe("docker.io/shepherdjerred/media:delivery-recipe");
});

test("Delivery binds both the API and its migration to the selected Media artifact", () => {
  const manifests = resources(
    "docker.io/shepherdjerred/media:delivery-recipe",
    true,
  );
  const api = manifests.find(
    (resource) =>
      resource.kind === "Deployment" &&
      resource.metadata.name === "media-media-api",
  );
  expect(api).toBeDefined();
  const container = z.object({ name: z.string(), image: z.string() });
  const pod = z
    .object({
      template: z.object({
        spec: z.object({
          containers: z.array(container),
          initContainers: z.array(container),
        }),
      }),
    })
    .parse(api?.spec).template.spec;
  const selected =
    '{{ required `Delivery requires image:media` (get (get (.Values.delivery | default dict) "images" | default dict) "media") }}';
  expect(pod.containers).toContainEqual({ name: "media-api", image: selected });
  expect(pod.initContainers).toContainEqual({
    name: "prisma-migrate",
    image: selected,
  });
});

test("separates network credentials from writable media mounts", () => {
  const DeploymentSchema = z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            env: z.array(
              z.object({
                name: z.string(),
                value: z.string().optional(),
                valueFrom: z
                  .object({
                    secretKeyRef: z
                      .object({
                        name: z.string(),
                        key: z.string(),
                        optional: z.boolean().optional(),
                      })
                      .optional(),
                  })
                  .optional(),
              }),
            ),
            volumeMounts: z.array(
              z.object({
                mountPath: z.string(),
                readOnly: z.boolean().optional(),
              }),
            ),
          }),
        ),
        automountServiceAccountToken: z.boolean(),
      }),
    }),
  });
  const manifests = resources();
  const bootstrap = manifests.find(
    (resource) =>
      resource.kind === "OnePasswordItem" &&
      resource.metadata.name.endsWith("media-config"),
  );
  expect(bootstrap).toBeDefined();
  const deployments = manifests.filter(
    (resource) => resource.kind === "Deployment",
  );
  expect(deployments).toHaveLength(3);
  for (const deployment of deployments) {
    const pod = DeploymentSchema.parse(deployment.spec).template.spec;
    expect(pod.automountServiceAccountToken).toBe(
      deployment.metadata.name.endsWith("media-network"),
    );
    const container = pod.containers[0];
    expect(container).toBeDefined();
    const mounts = container?.volumeMounts ?? [];
    const env = container?.env.map((value) => value.name) ?? [];
    ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN"].forEach(
      (key) => {
        const binding = container?.env.find((entry) => entry.name === key);
        const expected =
          key === "DISCORD_BOT_TOKEN"
            ? deployment.metadata.name.endsWith("media-network")
            : deployment.metadata.name.endsWith("media-api");
        if (expected) {
          expect(binding).toMatchObject({
            valueFrom: {
              secretKeyRef: {
                name: "media-streambot-config",
                key: key === "DISCORD_BOT_TOKEN" ? "BOT_TOKEN" : key,
              },
            },
          });
          expect(binding?.value).toBeUndefined();
          expect(binding?.valueFrom?.secretKeyRef?.optional).not.toBe(true);
        } else expect(binding).toBeUndefined();
      },
    );
    if (deployment.metadata.name.endsWith("media-files")) {
      const serverBinding = container?.env.find(
        (value) => value.name === "PLEX_SERVER_MACHINE_ID",
      );
      expect(serverBinding).toMatchObject({
        valueFrom: {
          secretKeyRef: {
            name: bootstrap?.metadata.name,
            key: "PLEX_SERVER_MACHINE_ID",
          },
        },
      });
      expect(serverBinding?.valueFrom?.secretKeyRef?.optional).not.toBe(true);
      expect(mounts).toContainEqual(
        expect.objectContaining({ mountPath: "/downloads", readOnly: true }),
      );
      expect(mounts.map((mount) => mount.mountPath)).toEqual(
        expect.arrayContaining(["/data/movies", "/data/tv"]),
      );
      expect(env).not.toContain("QBITTORRENT_PASSWORD");
      expect(env).not.toContain("PLEX_SERVER_TOKEN");
      expect(env).not.toContain("MEDIA_CREDENTIAL_KEY");
      expect(env).not.toContain("POSTAL_API_KEY");
      expect(env).not.toContain("TMDB_API_KEY");
    } else
      expect(mounts.map((mount) => mount.mountPath)).toEqual(
        deployment.metadata.name.endsWith("media-api")
          ? ["/var/cache/media/artwork", "/tmp"]
          : ["/tmp"],
      );
    if (deployment.metadata.name.endsWith("media-api")) {
      expect(container?.env).toContainEqual({
        name: "PLEX_SERVER_URL",
        value: "http://plex:32400",
      });
      expect(env).not.toContain("PLEX_SERVER_TOKEN");
    }
    if (deployment.metadata.name.endsWith("media-network")) {
      expect(env).toContain("TMDB_API_KEY");
    }
  }
});

test("declares protected PostgreSQL and denies files worker external network access", () => {
  const manifests = resources();
  expect(
    manifests.find((resource) => resource.kind === "postgresql"),
  ).toMatchObject({
    metadata: { labels: { "velero.io/backup": "enabled" } },
    spec: {
      volume: { storageClass: "zfs-ssd" },
      databases: { media_db: "media" },
    },
  });
  const policy = manifests.find(
    (resource) =>
      resource.kind === "NetworkPolicy" &&
      resource.metadata.name.endsWith("media-files-netpol"),
  );
  expect(policy).toBeDefined();
  const parsed = z
    .object({
      egress: z.array(
        z.object({ ports: z.array(z.object({ port: z.number() })) }),
      ),
    })
    .parse(policy?.spec);
  const ports = parsed.egress.flatMap((rule) =>
    rule.ports.map((port) => port.port),
  );
  expect(ports).toEqual(expect.arrayContaining([5432, 7233, 8080, 4318]));
  expect(ports).not.toContain(443);
  expect(ports).not.toContain(32_400);
  expect(ports).not.toContain(6443);
});

test("grants only the network observer namespace-scoped metadata reads", () => {
  const manifests = resources();
  const roles = manifests.filter((resource) => resource.kind === "Role");
  expect(roles).toHaveLength(1);
  const rules = z
    .array(
      z.object({
        apiGroups: z.array(z.string()),
        resources: z.array(z.string()),
        verbs: z.array(z.string()),
      }),
    )
    .parse(roles[0]?.rules);
  expect(rules.flatMap((rule) => rule.resources).sort()).toEqual([
    "cronjobs",
    "daemonsets",
    "deployments",
    "horizontalpodautoscalers",
    "jobs",
    "persistentvolumeclaims",
    "pods",
    "replicasets",
    "statefulsets",
  ]);
  expect(new Set(rules.flatMap((rule) => rule.verbs))).toEqual(
    new Set(["get", "list"]),
  );
  expect(
    manifests.filter((resource) => resource.kind === "ClusterRole"),
  ).toHaveLength(0);
  const binding = manifests.find((resource) => resource.kind === "RoleBinding");
  expect(binding?.subjects).toEqual([
    { kind: "ServiceAccount", name: "media-network", namespace: "media" },
  ]);
});

test("the API keeps its artwork cache on an unbacked-up single-writer claim", () => {
  const manifests = resources();
  expect(
    manifests.filter(
      (resource) =>
        resource.kind === "PersistentVolumeClaim" &&
        resource.metadata.name === "media-artwork-cache",
    ),
  ).toEqual([
    expect.objectContaining({
      metadata: expect.objectContaining({
        labels: {
          "velero.io/backup": "disabled",
          "velero.io/exclude-from-backup": "true",
        },
      }),
      spec: expect.objectContaining({
        accessModes: ["ReadWriteOnce"],
        storageClassName: "zfs-ssd-lz4",
        resources: { requests: { storage: "4Gi" } },
      }),
    }),
  ]);
  const api = manifests.find(
    (resource) =>
      resource.kind === "Deployment" &&
      resource.metadata.name.endsWith("media-api"),
  );
  expect(api?.spec).toMatchObject({
    strategy: { type: "Recreate" },
    template: {
      spec: {
        securityContext: { fsGroup: 1000 },
        volumes: expect.arrayContaining([
          expect.objectContaining({
            persistentVolumeClaim: {
              claimName: "media-artwork-cache",
              readOnly: false,
            },
          }),
        ]),
        containers: [
          expect.objectContaining({
            env: expect.arrayContaining([
              {
                name: "MEDIA_ARTWORK_CACHE_DIR",
                value: "/var/cache/media/artwork",
              },
            ]),
          }),
        ],
      },
    },
  });
});
