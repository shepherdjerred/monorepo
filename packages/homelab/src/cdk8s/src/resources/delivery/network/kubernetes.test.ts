import { App } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { createDeliveryControlPlaneChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery-control-plane.ts";

const Network = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({
    podSelector: z.object({ matchLabels: z.record(z.string(), z.string()) }),
    egress: z.array(
      z.object({
        to: z.array(z.unknown()).optional(),
        ports: z.array(z.object({ port: z.number(), protocol: z.string() })),
      }),
    ),
  }),
});

function rendered(workerEnabled: boolean) {
  const chart = createDeliveryControlPlaneChart(new App(), {
    image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
    serviceItemId: "service-item",
    executorItemId: "executor-item",
    argocdItemId: "workload-argo-item",
    platformRegistryItemId: "platform-reader-item",
    platformArgocdItemId: "platform-argo-item",
    ...(workerEnabled ? { workerRegistryItemId: "worker-reader-item" } : {}),
  });
  return chart.toJson();
}

test("actual Job creators and platform recovery admit only the reviewed post-DNAT Kubernetes endpoint", () => {
  const resources = rendered(true);
  const deployments = resources.flatMap((raw) => {
    const parsed = z
      .object({
        kind: z.literal("Deployment"),
        spec: z.object({
          template: z.object({
            metadata: z.object({ labels: z.record(z.string(), z.string()) }),
            spec: z.object({
              automountServiceAccountToken: z.boolean(),
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
        }),
      })
      .safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  const policies = resources.flatMap((raw) => {
    const parsed = Network.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  const clients = ["delivery-worker", "delivery-platform-worker"];
  for (const component of clients) {
    const workload = deployments.find(
      (row) => row.spec.template.metadata.labels["component"] === component,
    );
    expect(workload?.spec.template.spec.automountServiceAccountToken).toBe(
      true,
    );
    expect(
      workload?.spec.template.spec.containers[0]?.env.filter(
        (entry) => entry.name === "NODE_EXTRA_CA_CERTS",
      ),
    ).toEqual([
      {
        name: "NODE_EXTRA_CA_CERTS",
        value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      },
    ]);
  }
  const granted = policies.filter((policy) =>
    policy.spec.egress.some((rule) =>
      rule.ports.some((port) => port.port === 6443),
    ),
  );
  expect(
    granted.map(({ metadata, spec }) => [metadata.namespace, spec.podSelector]),
  ).toEqual([
    ["delivery-platform-jobs", { matchLabels: { app: "delivery-stage" } }],
    ["temporal", { matchLabels: { component: "delivery-platform-worker" } }],
    ["temporal", { matchLabels: { component: "delivery-worker" } }],
  ]);
  for (const policy of granted)
    expect(
      policy.spec.egress.filter((rule) =>
        rule.ports.some((port) => port.port === 6443),
      ),
    ).toEqual([
      {
        to: [{ ipBlock: { cidr: "192.168.1.81/32" } }],
        ports: [{ port: 6443, protocol: "TCP" }],
      },
    ]);
});

test("cold ordinary execution, tokenless worker Jobs and Workflow hosts gain no Kubernetes endpoint grant", () => {
  const denied = new Set<string>();
  for (const enabled of [false, true])
    for (const raw of rendered(enabled)) {
      const result = Network.safeParse(raw);
      if (!result.success) continue;
      const { metadata, spec } = result.data;
      const component = spec.podSelector.matchLabels["component"];
      if (
        component === "delivery-workflows" ||
        metadata.namespace === "delivery-worker-jobs" ||
        (!enabled && component === "delivery-worker")
      ) {
        denied.add(component ?? metadata.namespace);
        expect(
          spec.egress.some((rule) =>
            rule.ports.some((port) => port.port === 6443),
          ),
        ).toBe(false);
      }
    }
  expect([...denied].sort()).toEqual([
    "delivery-worker",
    "delivery-worker-jobs",
    "delivery-workflows",
  ]);
});
