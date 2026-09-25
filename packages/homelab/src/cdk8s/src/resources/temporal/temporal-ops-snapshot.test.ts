import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
  type TemporalResource,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";

const InfraDeploymentSpecSchema = z.object({
  template: z.object({
    spec: z.object({
      containers: z.array(z.object({ env: ContainerEnvSchema })),
    }),
  }),
});

const OPS_SECRETS = [
  "OPS_INGEST_TOKEN",
  "LINEAR_API_KEY",
  "POSTHOG_PERSONAL_API_KEY",
] as const;

function resources(): TemporalResource[] {
  return synthesizeTemporalResources(".test-synth-temporal-ops-snapshot");
}

function workerEnv(synthesized: readonly TemporalResource[], name: string) {
  const deployment = findTemporalResource(synthesized, "Deployment", name);
  const container = InfraDeploymentSpecSchema.parse(deployment.spec).template
    .spec.containers[0];
  if (container === undefined) {
    throw new Error(`Missing container in ${name}`);
  }
  return container.env;
}

describe("Temporal ops snapshot collector", () => {
  test("gives the infra worker its dashboard, upstream URLs, and required credentials", () => {
    const synthesized = resources();
    const env = workerEnv(synthesized, "temporal-temporal-infra-worker");
    const item = synthesized.find(
      (resource) =>
        resource.kind === "OnePasswordItem" &&
        JSON.stringify(resource.spec).includes("mjgnqqh37jxyzseqrddde2jgaq"),
    );
    if (item === undefined) {
      throw new Error("Missing Temporal worker 1Password item");
    }
    for (const key of OPS_SECRETS) {
      expect(env).toContainEqual({
        name: key,
        valueFrom: { secretKeyRef: { key, name: item.metadata.name } },
      });
    }
    expect(env).toContainEqual({
      name: "OPS_DASHBOARD_URL",
      value:
        "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    });
    expect(env).toContainEqual({
      name: "ALERTMANAGER_URL",
      value: "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
    });
    expect(env).toContainEqual({
      name: "LOKI_URL",
      value: "http://loki.loki.svc.cluster.local:3100",
    });
  });

  test("keeps the ops credentials off every other worker", () => {
    const synthesized = resources();
    for (const name of [
      "temporal-temporal-repo-worker",
      "temporal-temporal-scout-worker",
      "temporal-temporal-backup-worker",
      "temporal-temporal-billing-worker",
    ]) {
      const names = workerEnv(synthesized, name).map((entry) => entry.name);
      for (const key of OPS_SECRETS) {
        expect(names).not.toContain(key);
      }
    }
  });

  test("lets the infra worker reach Alertmanager and Loki", () => {
    const policy = findTemporalResource(
      resources(),
      "NetworkPolicy",
      "temporal-infra-api-netpol",
    );
    const egress = z
      .object({
        egress: z.array(
          z.object({
            to: z
              .array(
                z.object({
                  namespaceSelector: z.object({
                    matchLabels: z.record(z.string(), z.string()),
                  }),
                }),
              )
              .optional(),
            ports: z.array(z.object({ port: z.number() })),
          }),
        ),
      })
      .parse(policy.spec).egress;
    const byPort = new Map(
      egress.map((rule) => [
        rule.ports[0]?.port,
        rule.to?.[0]?.namespaceSelector.matchLabels[
          "kubernetes.io/metadata.name"
        ],
      ]),
    );
    expect(byPort.get(9093)).toBe("prometheus");
    expect(byPort.get(3100)).toBe("loki");
    // Kubernetes API and the dashboard ingest stay reachable.
    expect(byPort.has(6443)).toBe(true);
    expect(byPort.has(7341)).toBe(true);
  });
});
