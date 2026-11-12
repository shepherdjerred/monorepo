import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

// Registered once the public image digest is pinned. Keep this application in
// the activation branch so ArgoCD owns the complete service lifecycle.
export function createAlertDashboardApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "alert-dashboard",
    namespace: "alert-dashboard",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
