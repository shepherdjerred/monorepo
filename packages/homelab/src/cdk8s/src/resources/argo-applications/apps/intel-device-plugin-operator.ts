import type { Chart } from "cdk8s";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createIntelDevicePluginOperatorNamespace(chart: Chart): void {
  new Namespace(chart, "intel-plugin-namespcae", {
    metadata: {
      name: "intel-device-plugin-operator",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });
}

export function createIntelDevicePluginOperatorApp(chart: Chart) {
  createIntelDevicePluginOperatorNamespace(chart);

  helmApplication(chart, {
    name: "intel-device-plugin-operator",
    id: "intel-plugins-app",
    namespace: "intel-device-plugin-operator",
    chart: "intel-device-plugins-operator",
    // https://github.com/intel/helm-charts/tree/main/charts/device-plugin-operator
    repoUrl: "https://intel.github.io/helm-charts/",
    targetRevision: versions["intel-device-plugins-operator"],
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
