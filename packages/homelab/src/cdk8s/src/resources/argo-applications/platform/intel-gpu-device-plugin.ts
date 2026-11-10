import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";
export function createIntelGpuDevicePluginApp(chart: Chart) {
  const intelGpuValues: HelmValuesForChart<"intel-device-plugins-gpu"> = {
    sharedDevNum: 10,
    nodeFeatureRule: true,
  };

  return new Application(chart, "intel-gpu-device-plugin-app", {
    metadata: {
      name: "intel-gpu-device-plugin",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("intel-gpu-device-plugin"),
      source: {
        // https://github.com/intel/helm-charts/tree/main/charts/gpu-device-plugin
        repoUrl: "https://intel.github.io/helm-charts/",
        chart: "intel-device-plugins-gpu",
        targetRevision: versions["intel-device-plugins-gpu"],
        helm: {
          valuesObject: {
            ...intelGpuValues,
            // The GPU plugin chart no longer defines `resourceManager` (it was
            // an operator-era value). It is kept so this Application body, and
            // with it the Delivery recipe revision, stays byte-identical;
            // dropping it is a separate behavior change.
            resourceManager: false,
          },
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "intel-device-plugin-operator",
      },
      syncPolicy: {
        automated: { enabled: true },
      },
    },
  });
}
