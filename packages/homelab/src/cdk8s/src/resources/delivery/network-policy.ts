import type { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  kubernetesApiEgressRule,
  nsPeer,
  tcp,
  fliptEgress,
  postgresEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import {
  CI_STEP_POD_LABEL,
  DELIVERY_CI_API_STEPS,
} from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/step-network-policy.ts";
import { DELIVERY_TAILSCALE_INGRESS } from "@shepherdjerred/ops-model/delivery-ingress.ts";

export function createDeliveryNetworkPolicy(chart: Chart) {
  new KubeNetworkPolicy(chart, "application-network", {
    spec: {
      podSelector: { matchLabels: { app: "delivery" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        prometheusIngressRule([7353]),
        {
          from: [
            {
              ...nsPeer(DELIVERY_TAILSCALE_INGRESS.proxyNamespace),
              podSelector: {
                matchLabels: DELIVERY_TAILSCALE_INGRESS.parentLabels,
              },
            },
          ],
          ports: [tcp(7353)],
        },
        {
          from: [
            {
              ...nsPeer("temporal"),
              podSelector: { matchLabels: { component: "delivery-worker" } },
            },
            {
              ...nsPeer("temporal"),
              podSelector: {
                matchLabels: { component: "delivery-platform-worker" },
              },
            },
            {
              ...nsPeer("delivery-platform-jobs"),
              podSelector: { matchLabels: { app: "delivery-stage" } },
            },
            {
              ...nsPeer(WOODPECKER_CI_NAMESPACE),
              podSelector: {
                matchExpressions: [
                  {
                    key: CI_STEP_POD_LABEL,
                    operator: "In",
                    values: DELIVERY_CI_API_STEPS,
                  },
                ],
              },
            },
          ],
          ports: [tcp(7353)],
        },
      ],
      egress: [
        dnsEgressRule(),
        externalHttpsEgressRule(),
        kubernetesApiEgressRule(),
        postgresEgress("delivery-postgresql"),
        fliptEgress(),
        { to: [nsPeer("woodpecker")], ports: [tcp(8000)] },
        {
          to: ["storm-forum", "storm-forum-beta"].map((name) => ({
            ...nsPeer(name),
            podSelector: {
              matchLabels: { app: "storm-forum", component: "web" },
            },
          })),
          ports: [tcp(8082)],
        },
      ],
    },
  });
}
