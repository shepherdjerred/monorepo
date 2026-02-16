import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
export function createCertManagerApp(chart: Chart) {
  const certManagerValues: HelmValuesForChart<"cert-manager"> = {
    installCRDs: true,
    prometheus: {
      enabled: true,
      servicemonitor: {
        enabled: true,
      },
    },
    // TODO: these were causing issues
    // webhook: {
    //   prometheus: {
    //     enabled: true,
    //     servicemonitor: {
    //       enabled: true,
    //     },
    //   },
    // },
    // cainjector: {
    //   prometheus: {
    //     enabled: true,
    //     servicemonitor: {
    //       enabled: true,
    //     },
    //   },
    // },
  };

  return new Application(chart, "cert-manager-app", {
    metadata: {
      name: "cert-manager",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://artifacthub.io/packages/search?org=cert-manager
        repoUrl: "https://charts.jetstack.io",
        chart: "cert-manager",
        targetRevision: versions["cert-manager"],
        helm: {
          valuesObject: certManagerValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "cert-manager",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
