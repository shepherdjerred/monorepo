import { describe, expect, test } from "vitest";
import { z } from "zod";
import { allScoutTemporalResources } from "./scout-test-resources.ts";

describe("Scout competition Temporal boundary", () => {
  test.each(["beta", "prod"] as const)(
    "configures %s with the Temporal endpoint and egress",
    (stage) => {
      const synthesized = allScoutTemporalResources();
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
    const temporalIngress = allScoutTemporalResources().find(
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
