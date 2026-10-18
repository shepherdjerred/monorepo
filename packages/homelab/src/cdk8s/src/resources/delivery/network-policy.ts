import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  kubernetesApiEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import {
  CI_STEP_POD_LABEL,
  DELIVERY_CI_API_STEPS,
} from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/step-network-policy.ts";
import { DELIVERY_TAILSCALE_INGRESS } from "@shepherdjerred/ops-model/delivery-ingress.ts";

const ns = (name: string) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
});
const tcp = (port: number) => ({
  port: IntOrString.fromNumber(port),
  protocol: "TCP",
});

export function createDeliveryNetworkPolicy(chart: Chart) {
  new KubeNetworkPolicy(chart, "application-network", {
    spec: {
      podSelector: { matchLabels: { app: "delivery" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        { from: [ns("prometheus")], ports: [tcp(7353)] },
        {
          from: [
            {
              ...ns(DELIVERY_TAILSCALE_INGRESS.proxyNamespace),
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
              ...ns("temporal"),
              podSelector: { matchLabels: { component: "delivery-worker" } },
            },
            {
              ...ns("temporal"),
              podSelector: {
                matchLabels: { component: "delivery-platform-worker" },
              },
            },
            {
              ...ns("delivery-platform-jobs"),
              podSelector: { matchLabels: { app: "delivery-stage" } },
            },
            {
              ...ns("delivery-tsmc-controller"),
              podSelector: {
                matchLabels: { component: "delivery-tsmc-controller" },
              },
            },
            {
              ...ns(WOODPECKER_CI_NAMESPACE),
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
        {
          to: [
            {
              podSelector: {
                matchLabels: postgresClusterPodLabels("delivery-postgresql"),
              },
            },
          ],
          ports: [tcp(5432)],
        },
        { to: [ns("flipt")], ports: [tcp(8080)] },
        { to: [ns("woodpecker")], ports: [tcp(8000)] },
        {
          to: ["storm-forum", "storm-forum-beta"].map((name) => ({
            ...ns(name),
            podSelector: {
              matchLabels: { app: "storm-forum", component: "web" },
            },
          })),
          ports: [tcp(8082)],
        },
        {
          to: [
            {
              ...ns("delivery-tsmc-controller"),
              podSelector: {
                matchLabels: { component: "delivery-tsmc-controller" },
              },
            },
          ],
          ports: [tcp(7356)],
        },
      ],
    },
  });
}
