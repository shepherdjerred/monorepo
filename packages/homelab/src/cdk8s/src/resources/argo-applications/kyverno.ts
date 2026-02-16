import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "../../versions.ts";

export function createKyvernoApp(chart: Chart) {
  new Namespace(chart, "kyverno-namespace", {
    metadata: {
      name: "kyverno",
    },
  });

  const kyvernoValues = {
    admissionController: {
      replicas: 1,
    },
    backgroundController: {
      replicas: 1,
    },
    cleanupController: {
      replicas: 1,
    },
    reportsController: {
      replicas: 1,
    },
    // Fix for removed bitnami/kubectl image - use bitnamilegacy instead
    policyReportsCleanup: {
      image: {
        repository: "bitnamilegacy/kubectl",
        tag: "1.31",
      },
    },
    webhooksCleanup: {
      image: {
        repository: "bitnamilegacy/kubectl",
        tag: "1.31",
      },
    },
  };

  return new Application(chart, "kyverno-app", {
    metadata: {
      name: "kyverno",
      annotations: {
        // Deploy Kyverno CRDs before policies
        "argocd.argoproj.io/sync-wave": "1",
      },
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://kyverno.github.io/kyverno",
        targetRevision: versions.kyverno,
        chart: "kyverno",
        helm: {
          valuesObject: kyvernoValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "kyverno",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
