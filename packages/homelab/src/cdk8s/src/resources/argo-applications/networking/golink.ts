import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createGolinkApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "golink",
    namespace: "golink",
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
      automated: { enabled: true },
      syncOptions: ["ApplyOutOfSyncOnly=true", "RespectIgnoreDifferences=true"],
    },
  });
}
