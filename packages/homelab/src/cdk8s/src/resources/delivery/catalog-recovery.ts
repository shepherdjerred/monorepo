import type { Chart } from "cdk8s";
import {
  KubeNamespace,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export const DELIVERY_CATALOG_RECOVERY_NAMESPACE = "delivery-catalog-recovery";

/** An inert destination for the existing reviewed Velero/Spilo restore procedure, never an application writer. */
export function createDeliveryCatalogRecovery(chart: Chart) {
  const namespace = DELIVERY_CATALOG_RECOVERY_NAMESPACE;
  new KubeNamespace(chart, "catalog-recovery-namespace", {
    metadata: {
      name: namespace,
      namespace: "",
      labels: { "pod-security.kubernetes.io/enforce": "restricted" },
    },
  });
  new KubeNetworkPolicy(chart, "catalog-recovery-isolation", {
    metadata: { namespace },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: [],
    },
  });
}
