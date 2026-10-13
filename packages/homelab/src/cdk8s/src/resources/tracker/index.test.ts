import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createTrackerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/tracker.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const image = `ghcr.io/shepherdjerred/tracker@sha256:${"1".repeat(64)}`;
const manifest = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.unknown(),
});
const EnvSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  valueFrom: z
    .object({
      secretKeyRef: z.object({
        name: z.string(),
        key: z.string(),
        optional: z.boolean().optional(),
      }),
    })
    .optional(),
});
const container = z.object({
  name: z.string(),
  image: z.string(),
  command: z.array(z.string()),
  env: z.array(EnvSchema),
  securityContext: z.unknown(),
});
function manifests() {
  return z.array(manifest).parse(createTrackerChart(new App(), image).toJson());
}
beforeEach(resetProbeRegistry);

test("preregisters a hardened service and migration with operator-owned PostgreSQL and private ingress", () => {
  const resources = manifests();
  const deployment = resources.find(
    (resource) => resource.kind === "Deployment",
  );
  const spec = z
    .object({
      template: z.object({
        metadata: z.object({ labels: z.record(z.string(), z.string()) }),
        spec: z.object({
          containers: z.array(container),
          initContainers: z.array(container),
        }),
      }),
    })
    .parse(deployment?.spec);
  expect(spec.template.metadata.labels["app"]).toBe("tracker");
  for (const item of [
    ...spec.template.spec.containers,
    ...spec.template.spec.initContainers,
  ]) {
    expect(item.image).toBe(image);
    expect(item.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 1000,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    });
    const names = item.env.map((value) => value.name);
    expect(names.indexOf("DB_USER")).toBeLessThan(
      names.indexOf("DATABASE_URL"),
    );
    expect(names.indexOf("DB_PASSWORD")).toBeLessThan(
      names.indexOf("DATABASE_URL"),
    );
    for (const value of item.env)
      if (value.valueFrom !== undefined)
        expect(value.valueFrom.secretKeyRef.optional).not.toBe(true);
  }
  expect(spec.template.spec.initContainers[0]?.command).toEqual([
    "bunx",
    "--no-install",
    "prisma",
    "migrate",
    "deploy",
  ]);
  const database = resources.find((resource) => resource.kind === "postgresql");
  expect(database?.metadata.labels?.["velero.io/backup"]).toBe("enabled");
  expect(
    database?.metadata.annotations?.["argocd.argoproj.io/sync-options"],
  ).toBe("Delete=false");
  expect(database?.spec).toMatchObject({
    postgresql: { version: "18" },
    volume: { size: "32Gi" },
    databases: { tracker_db: "tracker" },
  });
  const ingress = resources.find((resource) => resource.kind === "Ingress");
  expect(ingress?.spec).toMatchObject({
    ingressClassName: "tailscale",
    tls: [{ hosts: ["tracker"] }],
  });
  expect(resources.some((resource) => resource.kind === "Application")).toBe(
    false,
  );
});

test("admits only tailnet, monitoring and the infra worker to the unauthenticated API", () => {
  const policy = manifests().find(
    (resource) => resource.kind === "NetworkPolicy",
  );
  const ingress = z
    .object({
      ingress: z.array(
        z.object({
          from: z.array(z.unknown()),
          ports: z.array(z.object({ port: z.number() })),
        }),
      ),
    })
    .parse(policy?.spec).ingress;
  expect(ingress).toEqual([
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
      ports: [{ port: 7351 }],
    },
    {
      from: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "temporal" },
          },
          podSelector: { matchLabels: { component: "infra-worker" } },
        },
      ],
      ports: [{ port: 7351 }],
    },
  ]);
});

test("rejects a mutable image before activation", () => {
  expect(() =>
    createTrackerChart(new App(), "ghcr.io/shepherdjerred/tracker:latest"),
  ).toThrow("pinned public image digest");
});
