import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createStormStatsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/storm-stats.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const ManifestSchema = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string().optional() }).optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
});

beforeEach(resetProbeRegistry);

test("a prepared service renders only its activation marker", () => {
  const resources = createStormStatsChart(new App(), false).toJson();
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
});

test("an activated service renders its multi-port workload, PVC, and network policy", () => {
  const manifests = z
    .array(ManifestSchema)
    .parse(createStormStatsChart(new App(), true).toJson());
  const kinds = manifests.map((manifest) => manifest.kind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      "Namespace",
      "Deployment",
      "OnePasswordItem",
      "PersistentVolumeClaim",
      "NetworkPolicy",
      "Service",
      "Ingress",
      "TunnelBinding",
    ]),
  );

  const secretItem = manifests.find((m) => m.kind === "OnePasswordItem");
  expect(secretItem).toMatchObject({
    metadata: { name: "storm-stats-secrets" },
    spec: { itemPath: expect.stringMatching(/\/items\/storm-stats$/u) },
  });

  const ingress = manifests.find((m) => m.kind === "Ingress");
  expect(ingress).toMatchObject({
    spec: {
      defaultBackend: {
        service: {
          name: "storm-stats-admin",
          port: { number: 7421 },
        },
      },
      tls: [{ hosts: ["storm-stats"] }],
    },
  });

  const deployment = manifests.find((m) => m.kind === "Deployment");
  expect(deployment).toMatchObject({
    spec: {
      strategy: { type: "Recreate" },
      template: {
        spec: {
          automountServiceAccountToken: false,
          securityContext: { fsGroup: 1000 },
          containers: [
            expect.objectContaining({
              name: "storm-stats",
              ports: expect.arrayContaining([
                expect.objectContaining({ name: "http", containerPort: 7420 }),
                expect.objectContaining({ name: "admin", containerPort: 7421 }),
                expect.objectContaining({
                  name: "ingest",
                  containerPort: 7422,
                }),
              ]),
              volumeMounts: expect.arrayContaining([
                expect.objectContaining({ mountPath: "/var/lib/storm-stats" }),
              ]),
            }),
          ],
        },
      },
    },
  });

  const pvc = manifests.find((m) => m.kind === "PersistentVolumeClaim");
  expect(pvc).toMatchObject({
    spec: {
      resources: {
        requests: { storage: "4Gi" },
      },
    },
  });

  const service = manifests.find(
    (m) => m.kind === "Service" && m.metadata?.name === "storm-stats",
  );
  expect(service).toMatchObject({
    metadata: { name: "storm-stats" },
    spec: {
      ports: expect.arrayContaining([
        expect.objectContaining({ name: "http", port: 7420 }),
        expect.objectContaining({ name: "ingest", port: 7422 }),
      ]),
    },
  });

  const adminService = manifests.find(
    (m) => m.kind === "Service" && m.metadata?.name === "storm-stats-admin",
  );
  expect(adminService).toMatchObject({
    metadata: { name: "storm-stats-admin" },
    spec: {
      ports: [expect.objectContaining({ name: "admin", port: 7421 })],
    },
  });

  const netpol = manifests.find(
    (m) =>
      m.kind === "NetworkPolicy" &&
      m.metadata?.name === "storm-stats-app-netpol",
  );
  expect(netpol).toMatchObject({
    spec: {
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-operator-system",
                },
              },
            },
          ],
          ports: [{ port: 7420, protocol: "TCP" }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
          ],
          ports: [{ port: 7421, protocol: "TCP" }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [
            { port: 7420, protocol: "TCP" },
            { port: 7421, protocol: "TCP" },
          ],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "minecraft-tsmc",
                },
              },
            },
          ],
          ports: [{ port: 7422, protocol: "TCP" }],
        },
      ],
    },
  });
});
