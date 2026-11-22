import { App } from "cdk8s";
import { beforeEach, describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";
import { createFlagsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/flags.ts";
import {
  FLAGS_EVALUATION_URL,
  FLAGS_MANAGEMENT_URL,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";
import { PodSelectorSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/pod-template-schema.ts";

beforeEach(resetProbeRegistry);

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
            env: ContainerEnvSchema,
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
    podSelector: PodSelectorSchema.optional(),
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
  test("configures every central worker for first-party Flags", () => {
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
      // PG-retained hosts are generated from this single frozen recipe.
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
      expect(environment.get("FEATURE_FLAGS_MODE")).toBe("flags");
      expect(environment.get("FLAGS_DEPLOYMENT")).toBe("temporal/prod");
      expect(environment.get("FLAGS_URL")).toBe(
        component === "repo-worker"
          ? FLAGS_MANAGEMENT_URL
          : FLAGS_EVALUATION_URL,
      );
      expect(environment.get("TELEMETRY_ENABLED")).toBe("true");
      expect(environment.get("OTLP_ENDPOINT")).toBeDefined();
      configuredComponents.add(component);
    }
    expect(configuredComponents).toEqual(expectedComponents);
  });

  test("grants the Flags machine token only to the repo operations worker", () => {
    const deployments = synthesizeTemporal().flatMap((resource) => {
      const parsed = DeploymentSchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    });
    const centralWorkers = deployments.filter(
      (deployment) =>
        deployment.spec.template.metadata.labels["app"] === "temporal-worker",
    );
    for (const deployment of centralWorkers) {
      const component = deployment.spec.template.metadata.labels["component"];
      const machineToken =
        deployment.spec.template.spec.containers[0]?.env.find(
          (entry) => entry.name === "FLAGS_MACHINE_TOKEN",
        );
      if (component === "repo-worker") {
        expect(machineToken?.valueFrom?.secretKeyRef).toEqual({
          key: "FLAGS_MACHINE_TOKEN",
          name: "flags-auth",
        });
      } else {
        expect(machineToken).toBeUndefined();
      }
      expect(
        deployment.spec.template.spec.containers[0]?.env.find(
          (entry) => entry.name === "FLIPT_OPERATOR_TOKEN",
        ),
      ).toBeUndefined();
    }
  });

  test("adds explicit worker egress policies to Flags", () => {
    const policies = synthesizeTemporal().flatMap((resource) => {
      const parsed = NetworkPolicySchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    });
    const evalPolicy = policies.find(
      (candidate) =>
        candidate.metadata.name === "temporal-workers-flags-egress",
    );
    expect(evalPolicy?.spec.egress).toHaveLength(1);
    expect(JSON.stringify(evalPolicy)).toContain('"port":7361');
    expect(JSON.stringify(evalPolicy)).toContain(
      '"kubernetes.io/metadata.name":"flags"',
    );
    expect(evalPolicy?.spec.podSelector?.matchExpressions).toEqual([
      {
        key: "component",
        operator: "In",
        values: [
          "gateway",
          "home-worker",
          "reports-worker",
          "infra-worker",
          "scout-worker",
          "glitter-corpus-worker",
          "glitter-context-worker",
          "agent-worker",
          "promotion-worker",
        ],
      },
    ]);

    const managementPolicy = policies.find(
      (candidate) => candidate.metadata.name === "temporal-repo-flags-netpol",
    );
    expect(managementPolicy?.spec.podSelector?.matchLabels).toEqual({
      component: "repo-worker",
    });
    expect(managementPolicy?.spec.egress).toEqual([
      {
        ports: [{ port: 7360, protocol: "TCP" }],
        to: [
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "flags" },
            },
          },
        ],
      },
    ]);
  });

  test("allows Temporal and Woodpecker namespaces through Flags ingress", () => {
    const app = new App({ outdir: ".test-synth-flags-temporal-consumer" });
    createFlagsChart(app);
    const manifest = app.synthYaml();
    expect(manifest).toContain("kubernetes.io/metadata.name: temporal");
    expect(manifest).toContain("component: repo-worker");
    expect(manifest).toContain("kubernetes.io/metadata.name: woodpecker");
    expect(manifest).toContain("kubernetes.io/metadata.name: woodpecker-ci");
  });
});
