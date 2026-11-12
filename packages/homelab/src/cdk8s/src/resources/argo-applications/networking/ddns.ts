import type { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createDdnsNamespace(chart: Chart): void {
  new Namespace(chart, `ddns-namespace`, {
    metadata: {
      name: `ddns`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });
}

export function createDdnsApp(chart: Chart) {
  createDdnsNamespace(chart);

  return createFirstPartyApplication(chart, {
    name: "ddns",
    namespace: "ddns",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
