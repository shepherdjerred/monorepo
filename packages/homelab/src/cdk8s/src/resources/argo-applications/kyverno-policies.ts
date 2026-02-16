import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createKyvernoPoliciesApp(chart: Chart) {
  return new Application(chart, "kyverno-policies-app", {
    metadata: {
      name: "kyverno-policies",
      annotations: {
        // Deploy after Kyverno is installed
        "argocd.argoproj.io/sync-wave": "5",
      },
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "kyverno-policies",
      },
      destination: {
        server: "https://kubernetes.default.svc",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["ServerSideApply=true"],
      },
      ignoreDifferences: [
        {
          group: "kyverno.io",
          kind: "ClusterPolicy",
          jsonPointers: [
            "/spec/admission",
            "/spec/background",
            "/spec/emitWarning",
            "/spec/validationFailureAction",
            "/spec/rules/0/skipBackgroundRequests",
          ],
        },
      ],
    },
  });
}
