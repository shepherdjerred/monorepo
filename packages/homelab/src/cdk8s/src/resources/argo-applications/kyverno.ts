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
    // Keep the CI machinery out of kyverno's webhook path entirely. The
    // admission webhooks are failurePolicy=Fail, so every kyverno restart is
    // an API outage for covered namespaces — and kyverno restarts under CI
    // load (25 restarts/27h on 2026-07-19; probe timeouts during node
    // stalls). Each outage silently rejected buildkite Job creates/updates:
    // finished pods wedged holding Kueue quota, and 'created' jobs never
    // materialized (phantom reservations that froze the whole pipeline —
    // builds 5663/5680/5700). No policy targets CI jobs; excluding the CI
    // namespaces removes the coupling. kyverno + kube-system stay excluded
    // per the chart default this selector replaces.
    config: {
      webhooks: {
        namespaceSelector: {
          matchExpressions: [
            {
              key: "kubernetes.io/metadata.name",
              operator: "NotIn",
              values: ["kyverno", "kube-system", "buildkite", "kueue-system"],
            },
          ],
        },
      },
    },
    admissionController: {
      replicas: 1,
      // Same correctness-not-capacity sizing rationale as kueue: probe
      // liveness under node contention needs scheduling weight.
      container: {
        resources: {
          requests: { cpu: "250m", memory: "256Mi" },
          limits: { cpu: "1000m", memory: "768Mi" },
        },
      },
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
