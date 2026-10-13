import { App } from "cdk8s";
import { describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createMarioKartChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/mario-kart.ts";

const Resource = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }),
  spec: z.record(z.string(), z.unknown()).optional(),
  subjects: z.array(z.object({ name: z.string() })).optional(),
});

function resources() {
  const app = new App();
  createMarioKartChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    Resource.parse(document.toJSON()),
  );
}

describe("Mario Kart direct ingress", () => {
  test("exposes only HTTP and HTTPS on the public NodePort service", () => {
    const services = resources().filter(
      (resource) => resource.kind === "Service",
    );
    const publicServices = services.filter(
      (service) => service.spec?.["type"] === "NodePort",
    );
    expect(publicServices).toHaveLength(1);
    expect(publicServices[0]?.spec).toMatchObject({
      externalTrafficPolicy: "Local",
      ports: [
        { name: "http", port: 80, targetPort: 8080, nodePort: 30_080 },
        { name: "https", port: 443, targetPort: 8443, nodePort: 30_443 },
      ],
    });
    expect(publicServices[0]?.spec?.["ports"]).toHaveLength(2);
    expect(
      services.find((service) =>
        service.metadata.name.endsWith("edge-bootstrap"),
      )?.spec,
    ).toMatchObject({
      type: "ClusterIP",
      ports: [{ port: 8082, targetPort: 8082 }],
    });
  });

  test("keeps the existing tunnel on the bootstrap listener until DNS cutover", () => {
    const synthesized = resources();
    const bootstrap = synthesized.find(
      (resource) =>
        resource.kind === "Service" &&
        resource.metadata.name.endsWith("edge-bootstrap"),
    );
    expect(bootstrap).toBeDefined();
    expect(
      synthesized.find((resource) => resource.kind === "TunnelBinding")
        ?.subjects,
    ).toEqual([expect.objectContaining({ name: bootstrap?.metadata.name })]);
  });

  test("preserves ACME state across replacement pods without overlapping RWO mounts", () => {
    const synthesized = resources();
    expect(
      synthesized.find(
        (resource) =>
          resource.kind === "Deployment" &&
          resource.metadata.name.endsWith("edge"),
      )?.spec,
    ).toMatchObject({
      replicas: 1,
      strategy: { type: "Recreate" },
      template: {
        spec: {
          automountServiceAccountToken: false,
          containers: [
            expect.objectContaining({
              securityContext: expect.objectContaining({
                runAsNonRoot: true,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              }),
              volumeMounts: expect.arrayContaining([
                expect.objectContaining({
                  mountPath: "/data",
                  name: "pvc-mario-kart-edge-data",
                }),
              ]),
            }),
          ],
          volumes: expect.arrayContaining([
            expect.objectContaining({
              persistentVolumeClaim: {
                claimName: "mario-kart-edge-data",
                readOnly: false,
              },
            }),
          ]),
        },
      },
    });
  });
});
