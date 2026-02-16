import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { Namespace } from "cdk8s-plus-31";

export function createIntelDevicePluginOperatorApp(chart: Chart) {
  new Namespace(chart, "intel-plugin-namespcae", {
    metadata: {
      name: "intel-device-plugin-operator",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  new Application(chart, "intel-plugins-app", {
    metadata: {
      name: "intel-device-plugin-operator",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/intel/helm-charts/tree/main/charts/device-plugin-operator
        repoUrl: "https://intel.github.io/helm-charts/",
        chart: "intel-device-plugins-operator",
        targetRevision: versions["intel-device-plugins-operator"],
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "intel-device-plugin-operator",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
