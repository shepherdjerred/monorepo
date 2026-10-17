import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

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
              ...ns("temporal"),
              podSelector: { matchLabels: { component: "delivery-worker" } },
            },
            {
              ...ns(WOODPECKER_CI_NAMESPACE),
              podSelector: {
                matchExpressions: [
                  {
                    key: "ci.sjer.red/step-key",
                    operator: "In",
                    values: ["delivery-publish", "scout-beta-release"],
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
      ],
    },
  });
}
