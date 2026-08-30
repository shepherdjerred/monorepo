import { App } from "cdk8s";
import { describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";
import { createFliptChart } from "./cdk8s-charts/flipt.ts";

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      metadata: z.object({
        labels: z.record(z.string(), z.string()),
      }),
      spec: z.object({
        containers: z.array(
          z.object({
            env: z.array(
              z.object({ name: z.string(), value: z.string().optional() }),
            ),
          }),
        ),
      }),
    }),
  }),
});

const NetworkPolicySchema = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    egress: z.array(z.unknown()).optional(),
    podSelector: z
      .object({
        matchExpressions: z
          .array(
            z.object({
              key: z.string(),
              operator: z.string(),
              values: z.array(z.string()).optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
});

function synthesizeTemporal(): unknown[] {
  const app = new App({ outdir: ".test-synth-temporal-feature-flags" });
  createTemporalChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    document.toJSON(),
  );
}

describe("Temporal feature-flag boundary", () => {
  test("configures every central worker for Flipt", () => {
    const expectedComponents = new Set([
      "gateway",
      "home-worker",
      "reports-worker",
      "infra-worker",
      "repo-worker",
      "scout-worker",
      "glitter-corpus-worker",
      "glitter-context-worker",
      "agent-worker",
      // The credentialless central-workflows track resolves the flag itself
      // (see temporal-workflow-boundary.test.ts) — it is the only role that
      // actually hosts workflow code, so it cannot skip this check.
      "central-workflows-stable",
      "central-workflows-candidate",
    ]);
    const deployments = synthesizeTemporal().flatMap((resource) => {
      const parsed = DeploymentSchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    });
    const configuredComponents = new Set<string>();
    for (const deployment of deployments) {
      const component = deployment.spec.template.metadata.labels["component"];
      if (component === undefined || !expectedComponents.has(component))
        continue;
      const environment = new Map(
        deployment.spec.template.spec.containers[0]?.env.map((entry) => [
          entry.name,
          entry.value,
        ]),
      );
      expect(environment.get("FEATURE_FLAGS_MODE")).toBe("flipt");
      expect(environment.get("FLIPT_URL")).toBe(
        "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
      );
      configuredComponents.add(component);
    }
    expect(configuredComponents).toEqual(expectedComponents);
  });

  test("adds an explicit worker egress policy to Flipt", () => {
    const policies = synthesizeTemporal().flatMap((resource) => {
      const parsed = NetworkPolicySchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    });
    const policy = policies.find(
      (candidate) =>
        candidate.metadata.name === "temporal-workers-flipt-egress",
    );
    expect(policy?.spec.egress).toHaveLength(1);
    expect(JSON.stringify(policy)).toContain('"port":8080');
    expect(JSON.stringify(policy)).toContain(
      '"kubernetes.io/metadata.name":"flipt"',
    );
    expect(policy?.spec.podSelector?.matchExpressions).toEqual([
      {
        key: "component",
        operator: "In",
        values: [
          "gateway",
          "home-worker",
          "reports-worker",
          "infra-worker",
          "repo-worker",
          "scout-worker",
          "glitter-corpus-worker",
          "glitter-context-worker",
          "agent-worker",
        ],
      },
    ]);
  });

  test("allows the Temporal namespace through Flipt ingress", () => {
    const app = new App({ outdir: ".test-synth-flipt-temporal-consumer" });
    createFliptChart(app);
    const manifest = app.synthYaml();
    expect(manifest).toContain("kubernetes.io/metadata.name: temporal");
  });

  test("allows the Buildkite namespace through Flipt ingress", () => {
    // The maintenance worker (buildkite-maintenance-worker.ts) runs the
    // shared temporal-worker image but lives in the `buildkite` namespace,
    // not `temporal` — without its own consumer entry, Flipt's own ingress
    // NetworkPolicy rejects it and temporal-call-graph-tracing silently
    // degrades to the default false for that worker.
    const app = new App({ outdir: ".test-synth-flipt-buildkite-consumer" });
    createFliptChart(app);
    const manifest = app.synthYaml();
    expect(manifest).toContain("kubernetes.io/metadata.name: buildkite");
  });
});
