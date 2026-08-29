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
      expect(env.get("TEMPORAL_NAMESPACE")).toBe(stage);
      expect(env.get("TEMPORAL_LEGACY_NAMESPACE")).toBe("default");

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

  test("creates only prod and beta with thirty-day retention", () => {
    const namespaceJob = allScoutTemporalResources().find(
      (resource) =>
        resource.kind === "Job" &&
        resource.metadata.name === "temporal-namespace-init",
    );
    const namespaceJobMetadata = z
      .object({
        annotations: z.record(z.string(), z.string()),
      })
      .parse(namespaceJob?.metadata);
    expect(namespaceJobMetadata.annotations["argocd.argoproj.io/hook"]).toBe(
      "PreSync",
    );
    const serialized = JSON.stringify(namespaceJob?.spec);
    expect(serialized).toContain("for namespace in prod beta");
    expect(serialized).toContain("--retention 720h");
    expect(serialized).not.toContain("for namespace in dev");
  });

  test("gives every central worker its active and drain namespaces", () => {
    const synthesized = allScoutTemporalResources();
    const workerNames = [
      "temporal-temporal-worker",
      "temporal-temporal-agent-worker",
      "temporal-temporal-gateway",
      "temporal-temporal-home-worker",
      "temporal-temporal-reports-worker",
      "temporal-temporal-glitter-corpus-worker",
      "temporal-temporal-glitter-context-worker",
      "temporal-temporal-infra-worker",
      "temporal-temporal-repo-worker",
      "temporal-temporal-scout-worker",
    ];
    for (const name of workerNames) {
      const deployment = synthesized.find(
        (resource) =>
          resource.kind === "Deployment" && resource.metadata.name === name,
      );
      const serialized = JSON.stringify(deployment?.spec);
      expect(serialized, name).toContain(
        '"name":"TEMPORAL_NAMESPACE","value":"prod"',
      );
      expect(serialized, name).toContain(
        '"name":"TEMPORAL_LEGACY_NAMESPACE","value":"default"',
      );
    }
  });

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
