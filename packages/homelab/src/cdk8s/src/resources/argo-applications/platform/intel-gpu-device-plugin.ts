import type { Chart } from "cdk8s";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
export function createIntelGpuDevicePluginApp(chart: Chart) {
  const intelGpuValues: HelmValuesForChart<"intel-device-plugins-gpu"> = {
    sharedDevNum: 10,
    nodeFeatureRule: true,
  };

  return helmApplication(chart, {
    name: "intel-gpu-device-plugin",
    namespace: "intel-device-plugin-operator",
    chart: "intel-device-plugins-gpu",
    // https://github.com/intel/helm-charts/tree/main/charts/gpu-device-plugin
    repoUrl: "https://intel.github.io/helm-charts/",
    targetRevision: versions["intel-device-plugins-gpu"],
    uncheckedValuesObject: {
      ...intelGpuValues,
      // The GPU plugin chart no longer defines `resourceManager` (it was
      // an operator-era value). It is kept so this Application body, and
      // with it the Delivery recipe revision, stays byte-identical;
      // dropping it is a separate behavior change.
      resourceManager: false,
    },
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
