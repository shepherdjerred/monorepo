import type { Chart } from "cdk8s";
import type { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { TUNNEL_BINDING_IGNORE_DIFFERENCES } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/apps.ts";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

/**
 * An Application the root never renders: Delivery creates it at the window's
 * ownership flip from its catalog recipe, and it adopts objects the root
 * applied (the cluster baseline charts and the upstream services' companion
 * charts). Server-side apply and the root's TunnelBinding ignore rule keep
 * that adoption free of field-manager and operator-default churn. A compound
 * recipe syncs a companion before its upstream Application, so the companion
 * creates the destination namespace on a cold start or after a deletion.
 */
export function createAdoptingApplication(
  chart: Chart,
  name: string,
  namespace: string,
): Application {
  return createFirstPartyApplication(chart, {
    name,
    namespace,
    ignoreDifferences: [TUNNEL_BINDING_IGNORE_DIFFERENCES],
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: [
        "CreateNamespace=true",
        "ServerSideApply=true",
        "RespectIgnoreDifferences=true",
      ],
    },
  });
}
