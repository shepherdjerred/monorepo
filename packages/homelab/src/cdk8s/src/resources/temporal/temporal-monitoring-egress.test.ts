import { expect, test } from "vitest";
import { z } from "zod";
import {
  ALERTMANAGER_GATEWAY_PORT,
  PROMETHEUS_GATEWAY_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";
import { synthesizeTemporalResources } from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";

const MonitoringPeer = z.object({
  namespaceSelector: z.object({
    matchLabels: z.object({
      "kubernetes.io/metadata.name": z.literal("prometheus"),
    }),
  }),
});
const EgressRule = z.object({
  ports: z
    .array(z.object({ port: z.union([z.number(), z.string()]) }))
    .optional(),
  to: z.array(z.unknown()).optional(),
});
const PolicySpec = z.object({ egress: z.array(EgressRule).optional() });
const SERVICE_PORTS = new Set<number | string>([9090, 9093]);

/**
 * Prometheus and Alertmanager listen on loopback behind a same-pod gateway,
 * and their Services map 9090 and 9093 onto the gateway's 9091 and 9094.
 * NetworkPolicy matches the pod port, so a rule for a Service port admits
 * nothing once a policy controller enforces it.
 */
test("Temporal workers reach Prometheus and Alertmanager only on their gateway pod ports", () => {
  const policies = synthesizeTemporalResources(
    ".test-synth-temporal-monitoring-egress",
  ).flatMap((resource) =>
    resource.kind === "NetworkPolicy"
      ? [
          {
            name: resource.metadata.name,
            egress: PolicySpec.parse(resource.spec).egress ?? [],
          },
        ]
      : [],
  );

  const monitoringEgress = policies.flatMap(({ name, egress }) => {
    const ports = egress
      .filter((rule) =>
        (rule.to ?? []).some((peer) => MonitoringPeer.safeParse(peer).success),
      )
      .flatMap((rule) => (rule.ports ?? []).map(({ port }) => port));
    return ports.length === 0 ? [] : [[name, ports] as const];
  });
  // Agent and audit collectors query Prometheus; the gateway, reports, repo
  // and ops-snapshot collectors post to or read Alertmanager.
  expect(Object.fromEntries(monitoringEgress)).toEqual({
    "temporal-agent-worker-netpol": [PROMETHEUS_GATEWAY_PORT],
    "temporal-gateway-ingress-netpol": [ALERTMANAGER_GATEWAY_PORT],
    "temporal-reports-internal-netpol": [ALERTMANAGER_GATEWAY_PORT],
    "temporal-repo-alertmanager-netpol": [ALERTMANAGER_GATEWAY_PORT],
    "temporal-infra-api-netpol": [
      PROMETHEUS_GATEWAY_PORT,
      "grafana",
      ALERTMANAGER_GATEWAY_PORT,
    ],
  });

  // No egress rule, scoped or not, names a monitoring Service port.
  const servicePortRules = policies.flatMap(({ name, egress }) =>
    egress
      .filter((rule) =>
        (rule.ports ?? []).some(({ port }) => SERVICE_PORTS.has(port)),
      )
      .map(() => name),
  );
  expect(servicePortRules).toEqual([]);
  expect([PROMETHEUS_GATEWAY_PORT, ALERTMANAGER_GATEWAY_PORT]).toEqual([
    9091, 9094,
  ]);
});
