import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createBrimServiceChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/brim-service.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const Manifest = z.looseObject({ kind: z.string() });

beforeEach(resetProbeRegistry);

test("a prepared service renders only its activation marker", () => {
  const resources = createBrimServiceChart(new App(), false).toJson();
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
});

test("an activated service renders its workload", () => {
  const kinds = z
    .array(Manifest)
    .parse(createBrimServiceChart(new App(), true).toJson())
    .map((manifest) => manifest.kind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      "Namespace",
      "Deployment",
      "NetworkPolicy",
      "Service",
      "Ingress",
    ]),
  );
});

test("backs up single-writer metadata without copying the decrypted archive", () => {
  const resources = createBrimServiceChart(new App(), true).toJson();
  expect(resources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "PersistentVolumeClaim",
        metadata: expect.objectContaining({
          name: "brim-service-data",
          labels: expect.objectContaining({ "velero.io/backup": "enabled" }),
        }),
      }),
      expect.objectContaining({
        kind: "PersistentVolumeClaim",
        metadata: expect.objectContaining({
          name: "brim-service-archive",
          labels: expect.objectContaining({ "velero.io/backup": "disabled" }),
        }),
        spec: expect.objectContaining({
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "64Gi" } },
        }),
      }),
      expect.objectContaining({
        kind: "Deployment",
        spec: expect.objectContaining({
          replicas: 1,
          strategy: { type: "Recreate" },
          template: expect.objectContaining({
            spec: expect.objectContaining({
              automountServiceAccountToken: false,
              volumes: expect.arrayContaining([
                expect.objectContaining({
                  persistentVolumeClaim: {
                    claimName: "brim-service-archive",
                    readOnly: false,
                  },
                }),
              ]),
              containers: [
                expect.objectContaining({
                  securityContext: expect.objectContaining({
                    readOnlyRootFilesystem: true,
                  }),
                  volumeMounts: expect.arrayContaining([
                    expect.objectContaining({ mountPath: "/data" }),
                    expect.objectContaining({ mountPath: "/archive" }),
                  ]),
                }),
              ],
            }),
          }),
        }),
      }),
    ]),
  );
});

test("admits only the Brim tailnet proxy, Hub, and the infra worker for application traffic", () => {
  const resources = createBrimServiceChart(new App(), true).toJson();
  const metadata = z.object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }),
  });
  const ingress = z
    .array(metadata)
    .parse(resources)
    .find(({ kind }) => kind === "Ingress");
  expect(ingress).toBeDefined();
  expect(resources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "NetworkPolicy",
        spec: expect.objectContaining({
          ingress: expect.arrayContaining([
            {
              from: [
                {
                  namespaceSelector: {
                    matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
                  },
                  podSelector: {
                    matchLabels: {
                      "tailscale.com/managed": "true",
                      "tailscale.com/parent-resource-type": "ingress",
                      "tailscale.com/parent-resource-ns": "brim-service",
                      "tailscale.com/parent-resource": ingress?.metadata.name,
                    },
                  },
                },
                {
                  namespaceSelector: {
                    matchLabels: {
                      "kubernetes.io/metadata.name": "alert-dashboard",
                    },
                  },
                  podSelector: { matchLabels: { app: "alert-dashboard" } },
                },
                {
                  namespaceSelector: {
                    matchLabels: { "kubernetes.io/metadata.name": "temporal" },
                  },
                  podSelector: { matchLabels: { component: "infra-worker" } },
                },
              ],
              ports: [{ port: 7458, protocol: "TCP" }],
            },
          ]),
        }),
      }),
    ]),
  );
});
