import { App } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { createDeliveryControlPlaneChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery-control-plane.ts";
import { PROMETHEUS_GATEWAY_PORT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";

const MonitoringPeer = z.object({
  namespaceSelector: z.object({
    matchLabels: z.object({
      "kubernetes.io/metadata.name": z.literal("prometheus"),
    }),
  }),
});
const EgressRule = z.object({
  ports: z.array(z.object({ port: z.number() })).optional(),
  to: z.array(z.unknown()).optional(),
});
const Policy = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ namespace: z.string() }),
  spec: z.object({
    egress: z.array(EgressRule),
    podSelector: z.object({ matchLabels: z.record(z.string(), z.string()) }),
  }),
});

/**
 * Prometheus and Alertmanager listen on loopback behind a same-pod gateway,
 * and their Services map 9090 and 9093 onto the gateway's 9091 and 9094.
 * NetworkPolicy matches the pod port, so a rule for a Service port admits
 * nothing once a policy controller enforces it.
 */
test("Delivery reaches Prometheus only on its gateway pod port, and only where a recipe queries it", () => {
  const monitoringEgress = createDeliveryControlPlaneChart(new App())
    .toJson()
    .flatMap((raw) => {
      const parsed = Policy.safeParse(raw);
      if (!parsed.success) {
        return [];
      }
      const { metadata, spec } = parsed.data;
      const ports = spec.egress
        .filter((rule) =>
          (rule.to ?? []).some(
            (peer) => MonitoringPeer.safeParse(peer).success,
          ),
        )
        .flatMap((rule) => (rule.ports ?? []).map(({ port }) => port));
      const selected = Object.values(spec.podSelector.matchLabels).join(",");
      return ports.length === 0
        ? []
        : [[`${metadata.namespace}/${selected}`, ports] as const];
    });
  // Worker poller proofs run in the worker and its proof Jobs. Platform Jobs
  // never query Prometheus, and nothing in Delivery posts to Alertmanager.
  expect(Object.fromEntries(monitoringEgress)).toEqual({
    "temporal/delivery-worker": [PROMETHEUS_GATEWAY_PORT],
    "delivery-worker-jobs/delivery-stage": [PROMETHEUS_GATEWAY_PORT],
  });
  expect(PROMETHEUS_GATEWAY_PORT).toBe(9091);
});
