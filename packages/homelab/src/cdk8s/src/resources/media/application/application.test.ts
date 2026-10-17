import { beforeEach, expect, test } from "vitest";
import { App, Chart, Size } from "cdk8s";
import { PersistentVolumeClaim, Secret } from "cdk8s-plus-31";
import { z } from "zod";
import { createUnifiedMediaApplication } from "./index.ts";
import { mediaImageReference } from "./image.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import {
  attachDockerHubPullSecrets,
  prepareDockerHubPullSecrets,
} from "@shepherdjerred/homelab/cdk8s/src/dockerhub-pull-secrets.ts";

beforeEach(resetProbeRegistry);
const image = `docker.io/shepherdjerred/media@sha256:${"1".repeat(64)}`;
function resources() {
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
    image,
    claims,
    plex: {
      serviceName: "plex",
      tokenSecret: Secret.fromSecretName(chart, "plex-token", "plex-secret"),
    },
  });
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
  expect(mediaImageReference(`0.0.0@sha256:${"0".repeat(64)}`)).toBeUndefined();
  expect(() => mediaImageReference("latest")).toThrow("immutable");
  expect(mediaImageReference(`1.0.0@sha256:${"1".repeat(64)}`)).toBe(image);
});

test("separates network credentials from writable media mounts", () => {
  const DeploymentSchema = z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            env: z.array(
              z.object({ name: z.string(), value: z.string().optional() }),
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
  const deployments = resources().filter(
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
    if (deployment.metadata.name.endsWith("media-files")) {
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
    } else expect(mounts.map((mount) => mount.mountPath)).toEqual(["/tmp"]);
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
    expect(env).not.toContain("DISCORD_CLIENT_SECRET");
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
