import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

export function createKyvernoApp(chart: Chart) {
  new Namespace(chart, "kyverno-namespace", {
    metadata: {
      name: "kyverno",
    },
  });

  const kyvernoValues: HelmValuesForChart<"kyverno"> = {
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
    // NOTE: a stale bitnami/kubectl override for the cleanup pre-delete hooks
    // used to live here. It was added at kyverno 3.6.2 to work around the chart
    // shipping the (removed) bitnami/kubectl image. kyverno 3.8.0 no longer uses
    // bitnami/kubectl: `webhooksCleanup` defaults to ghcr.io/kyverno/readiness-checker
    // and `policyReportsCleanup` no longer exists at all (it was a silent no-op
    // — typing this values object surfaced it). The override is therefore
    // obsolete and was removed so the chart's maintained defaults apply.
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
        syncOptions: [
          "CreateNamespace=true",
          "ServerSideApply=true",
          "RespectIgnoreDifferences=true",
        ],
      },
      // Kyverno 3.7.1 renders `labels: {}` and `annotations: {}` on CRDs;
      // Kubernetes normalizes these away and injects conversion.strategy and status,
      // causing perpetual OutOfSync.
      ignoreDifferences: [
        {
          group: "apiextensions.k8s.io",
          kind: "CustomResourceDefinition",
          jqPathExpressions: [
            ".metadata.labels",
            ".metadata.annotations",
            ".spec.conversion",
            ".status",
          ],
        },
      ],
    },
  });
}
