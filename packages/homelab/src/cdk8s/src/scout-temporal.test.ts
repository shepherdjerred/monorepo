import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createScoutChart } from "./cdk8s-charts/scout.ts";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string(), namespace: z.string().optional() }),
    spec: z.unknown().optional(),
  })
  .loose();

function resources() {
  const app = new App({ outdir: ".test-synth-scout-temporal" });
  createTemporalChart(app);
  createScoutChart(app, "beta");
  createScoutChart(app, "prod");
  return parseAllDocuments(app.synthYaml()).flatMap((document) => {
    const parsed = ResourceSchema.safeParse(document.toJSON());
    return parsed.success ? [parsed.data] : [];
  });
}

describe("Scout competition Temporal boundary", () => {
  test.each(["beta", "prod"] as const)(
    "configures %s with the Temporal endpoint and egress",
    (stage) => {
      const synthesized = resources();
      const deployment = synthesized.find(
        (resource) =>
          resource.kind === "Deployment" &&
          resource.metadata.namespace === `scout-${stage}` &&
          resource.metadata.name === `scout-${stage}-scout-backend`,
      );
      const deploymentSpec = z
        .object({
          template: z.object({
            spec: z.object({
              containers: z.array(
                z.object({
                  env: z.array(
                    z.object({
                      name: z.string(),
                      value: z.string().optional(),
                    }),
                  ),
                }),
              ),
            }),
          }),
        })
        .parse(deployment?.spec);
      const env = new Map(
        deploymentSpec.template.spec.containers[0]?.env.map((entry) => [
          entry.name,
          entry.value,
        ]),
      );
      expect(env.get("TEMPORAL_ADDRESS")).toBe(
        "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
      );

      const egressPolicy = synthesized.find(
        (resource) =>
          resource.kind === "NetworkPolicy" &&
          resource.metadata.namespace === `scout-${stage}` &&
          resource.metadata.name === "scout-egress-netpol",
      );
      expect(JSON.stringify(egressPolicy?.spec)).toContain('"port":7233');
      expect(JSON.stringify(egressPolicy?.spec)).toContain(
        '"kubernetes.io/metadata.name":"temporal"',
      );
    },
  );

  test("allows both Scout stages into the Temporal frontend", () => {
    const temporalIngress = resources().find(
      (resource) =>
        resource.kind === "NetworkPolicy" &&
        resource.metadata.namespace === "temporal" &&
        resource.metadata.name === "temporal-server-netpol",
    );
    const serialized = JSON.stringify(temporalIngress?.spec);
    expect(serialized).toContain('"kubernetes.io/metadata.name":"scout-beta"');
    expect(serialized).toContain('"kubernetes.io/metadata.name":"scout-prod"');
    expect(serialized).toContain('"app":"scout-backend"');
    expect(serialized).toContain('"port":7233');
  });
});
