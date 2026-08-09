import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createGolinkApp(chart: Chart) {
  return new Application(chart, "golink-app", {
    metadata: {
      name: "golink",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "golink",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "golink",
      },
      // Kubernetes assigns spec.volumeName after binding the generated PVC.
      // Argo's typed normalization otherwise tries to clear that immutable
      // field on later syncs, leaving the current revision Operation=Failed.
      ignoreDifferences: [
        {
          group: "",
          kind: "PersistentVolumeClaim",
          name: "golink-pvc",
          namespace: "golink",
          jsonPointers: ["/spec/volumeName"],
        },
      ],
      syncPolicy: {
        automated: {},
        syncOptions: [
          "ApplyOutOfSyncOnly=true",
          "RespectIgnoreDifferences=true",
        ],
      },
    },
  });
}
