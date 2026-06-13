import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
export function createCertManagerApp(chart: Chart) {
  const certManagerValues: HelmValuesForChart<"cert-manager"> = {
    installCRDs: true,
    prometheus: {
      enabled: true,
      servicemonitor: {
        enabled: true,
      },
    },
    // Baseline requests (no limits) so cert renewal isn't BestEffort.
    // All three components idle under 10m / 150Mi (30d).
    resources: {
      requests: {
        cpu: "10m",
        memory: "128Mi",
      },
    },
    webhook: {
      resources: {
        requests: {
          cpu: "10m",
          memory: "64Mi",
        },
      },
    },
    cainjector: {
      resources: {
        requests: {
          cpu: "10m",
          memory: "128Mi",
        },
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
