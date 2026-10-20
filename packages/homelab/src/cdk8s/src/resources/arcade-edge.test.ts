import { App, Chart, Testing } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { createArcadeEdge } from "./arcade-edge.ts";

const Resource = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.record(z.string(), z.unknown()).optional(),
});

function resources() {
  const chart = new Chart(new App(), "arcade", {
    namespace: "arcade",
    disableResourceNameHashes: true,
  });
  createArcadeEdge(chart);
  return Testing.synth(chart).map((resource) => Resource.parse(resource));
}

test("the prepared edge cannot take live ports or hostname ownership", () => {
  const manifests = resources();
  const services = manifests.filter((resource) => resource.kind === "Service");
  expect(services).toHaveLength(3);
  expect(
    services.every((service) => service.spec?.["type"] === "ClusterIP"),
  ).toBe(true);
  expect(JSON.stringify(services)).not.toContain('"nodePort"');
  expect(
    manifests.filter((resource) =>
      ["Ingress", "TunnelBinding", "OnePasswordItem", "Secret"].includes(
        resource.kind,
      ),
    ),
  ).toEqual([]);
});

test("TLS migration gates Caddy startup while preserving its security and RWO ownership", () => {
  const manifests = resources();
  const deployment = manifests.find(
    (resource) => resource.kind === "Deployment",
  );
  expect(deployment?.metadata.name).toBe("arcade-edge");
  expect(deployment?.spec).toMatchObject({
    replicas: 1,
    strategy: { type: "Recreate" },
    template: {
      spec: {
        automountServiceAccountToken: false,
        containers: [
          expect.objectContaining({
            command: ["/bin/sh", "-ec"],
            args: [
              expect.stringContaining("/data/.arcade-edge-migration-ready"),
            ],
            startupProbe: {
              httpGet: { path: "/healthz", port: 8082, scheme: "HTTP" },
              failureThreshold: 120,
              periodSeconds: 10,
            },
            securityContext: expect.objectContaining({
              runAsUser: 1000,
              runAsGroup: 1000,
              runAsNonRoot: true,
              readOnlyRootFilesystem: true,
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"] },
            }),
          }),
        ],
        volumes: expect.arrayContaining([
          expect.objectContaining({
            persistentVolumeClaim: {
              claimName: "arcade-edge-data",
              readOnly: false,
            },
          }),
        ]),
      },
    },
  });
  const pvc = manifests.find(
    (resource) => resource.kind === "PersistentVolumeClaim",
  );
  expect(pvc?.metadata.name).toBe("arcade-edge-data");
  expect(pvc?.spec).toMatchObject({
    accessModes: ["ReadWriteOnce"],
    storageClassName: "zfs-ssd",
    resources: { requests: { storage: "1Gi" } },
  });
  expect(pvc?.metadata.labels).toMatchObject({
    "velero.io/backup": "enabled",
    "velero.io/exclude-from-backup": "false",
  });
});
