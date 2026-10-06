import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

function resources() {
  const app = new App();
  createTemporalChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    ResourceSchema.parse(document.toJSON()),
  );
}

describe("Temporal external authentication boundary", () => {
  test("keeps internal gRPC raw and sends only Tailscale through the token gateway", () => {
    const synthesized = resources();
    const internalService = synthesized.find(
      (resource) =>
        resource.kind === "Service" &&
        resource.metadata.name.endsWith("temporal-server-service"),
    );
    expect(internalService?.["spec"]).toMatchObject({
      ports: [{ port: 7233 }],
    });

    const externalService = synthesized.find(
      (resource) =>
        resource.kind === "Service" &&
        resource.metadata.name.endsWith("temporal-external-server-service"),
    );
    expect(externalService?.["spec"]).toMatchObject({
      ports: [{ port: 7233, targetPort: 7234 }],
    });

    const ingress = synthesized.find(
      (resource) =>
        resource.kind === "Ingress" &&
        resource.metadata.name.includes("temporal-tailscale-ingress"),
    );
    expect(JSON.stringify(ingress?.["spec"])).toContain(
      "temporal-external-server-service",
    );

    const policy = synthesized.find(
      (resource) =>
        resource.kind === "NetworkPolicy" &&
        resource.metadata.name === "temporal-server-netpol",
    );
    const policyText = JSON.stringify(policy?.["spec"]);
    expect(policyText).toContain("tailscale");
    expect(policyText).toContain('"port":7234');
    expect(policyText).toContain("temporal-ui");
    expect(policyText).toContain('"port":7233');
  });

  test("protects the UI without changing its public service port", () => {
    const synthesized = resources();
    const item = synthesized.find(
      (resource) =>
        resource.kind === "OnePasswordItem" &&
        resource.metadata.name === "temporal-external-auth",
    );
    expect(JSON.stringify(item?.["spec"])).toContain(
      "2x4fpii5zq4jbw3l2p2qkvjtiy",
    );

    const service = synthesized.find(
      (resource) =>
        resource.kind === "Service" &&
        resource.metadata.name.endsWith("temporal-ui-service"),
    );
    expect(service?.["spec"]).toMatchObject({ ports: [{ port: 8080 }] });

    const deployment = synthesized.find(
      (resource) =>
        resource.kind === "Deployment" &&
        resource.metadata.name.endsWith("temporal-ui"),
    );
    const containerText = JSON.stringify(deployment?.["spec"]);
    expect(containerText).toContain("authenticated-gateway");
    expect(containerText).toContain("TEMPORAL_UI_BASIC_HASH");
    expect(containerText).toContain('"containerPort":8081');
  });
});
