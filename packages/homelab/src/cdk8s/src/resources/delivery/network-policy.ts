import type { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  kubernetesApiEgressRule,
  nsPeer,
  tcp,
  flagsEgress,
  postgresEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { CI_STEP_POD_LABEL } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/pod-labels.ts";
import { DELIVERY_CI_API_STEPS } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/step-network-policy.ts";
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
            // The retained Minecraft controller loads the deployment while
            // answering a recovery-report request (see egress below).
            {
              ...nsPeer("delivery-tsmc-controller"),
              podSelector: {
                matchLabels: {
                  app: "delivery-tsmc-controller",
                  component: "delivery-tsmc-controller",
                },
              },
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
        flagsEgress(),
        {
          to: ["storm-forum", "storm-forum-beta"].map((name) => ({
            ...nsPeer(name),
            podSelector: {
              matchLabels: { app: "storm-forum", component: "web" },
            },
          })),
          ports: [tcp(8082)],
        },
        // Minecraft recovery completion reads the retained controller's
        // recovery report (packages/delivery/src/server/index.ts). The
        // controller's live-only ingress policy already admits app=delivery.
        {
          to: [
            {
              ...nsPeer("delivery-tsmc-controller"),
              podSelector: {
                matchLabels: {
                  app: "delivery-tsmc-controller",
                  component: "delivery-tsmc-controller",
                },
              },
            },
          ],
          ports: [tcp(7356)],
        },
      ],
    },
  });
}
