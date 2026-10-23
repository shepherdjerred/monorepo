import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";
import { TUNNEL_BINDING_IGNORE_DIFFERENCES } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/apps.ts";

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
  return new Application(chart, `${name}-app`, {
    metadata: { name },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject(name),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: name,
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace,
      },
      ignoreDifferences: [TUNNEL_BINDING_IGNORE_DIFFERENCES],
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: [
          "CreateNamespace=true",
          "ServerSideApply=true",
          "RespectIgnoreDifferences=true",
        ],
      },
    },
  });
}
