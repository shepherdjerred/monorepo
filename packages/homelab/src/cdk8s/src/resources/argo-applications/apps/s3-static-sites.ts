import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createS3StaticSitesApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "s3-static-sites",
    namespace: "s3-static-sites",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
