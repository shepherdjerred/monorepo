import type { Chart } from "cdk8s";
import { Duration } from "cdk8s";
import { Job, ServiceAccount } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { ARGOCD_SYNC_WAVE_ANNOTATION } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { kubectlScriptContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/kubectl-script-container.ts";
import { SCOUT_ACTIVITY_WORKER_APP_LABEL } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/activity-worker.ts";

export const SCOUT_ACTIVITY_WORKER_RETIREMENT_GATE_NAME =
  "scout-activity-worker-retirement-gate";

/**
 * A zero-replica Deployment can be Healthy while its old pod is terminating.
 * The -1 hook keeps the wave-0 application from reclaiming queues until the
 * -2 worker scale-down has actually removed every worker pod.
 */
export function createScoutActivityWorkerRetirementGate(
  chart: Chart,
  stage: Stage,
) {
  const name = SCOUT_ACTIVITY_WORKER_RETIREMENT_GATE_NAME;
  const namespace = `scout-${stage}`;
  const prerequisiteAnnotations = {
    [ARGOCD_SYNC_WAVE_ANNOTATION]: "-3",
  };
  const serviceAccount = new ServiceAccount(chart, `${name}-service-account`, {
    metadata: { name, annotations: prerequisiteAnnotations },
  });

  new KubeRole(chart, `${name}-role`, {
    metadata: { name, annotations: prerequisiteAnnotations },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list", "watch"],
      },
    ],
  });
  new KubeRoleBinding(chart, `${name}-role-binding`, {
    metadata: { name, annotations: prerequisiteAnnotations },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name,
    },
    subjects: [
      { kind: "ServiceAccount", name: serviceAccount.name, namespace },
    ],
  });
  new KubeNetworkPolicy(chart, `${name}-netpol`, {
    metadata: { name: `${name}-netpol`, annotations: prerequisiteAnnotations },
    spec: {
      podSelector: { matchLabels: { app: name } },
      policyTypes: ["Ingress", "Egress"],
      egress: [
        { ports: [{ port: IntOrString.fromNumber(6443), protocol: "TCP" }] },
      ],
    },
  });

  const job = new Job(chart, name, {
    metadata: {
      name,
      annotations: {
        "argocd.argoproj.io/hook": "Sync",
        "argocd.argoproj.io/hook-delete-policy":
          "BeforeHookCreation,HookSucceeded",
        [ARGOCD_SYNC_WAVE_ANNOTATION]: "-1",
      },
    },
    serviceAccount,
    automountServiceAccountToken: true,
    backoffLimit: 0,
    activeDeadline: Duration.seconds(150),
    podMetadata: { labels: { app: name } },
  });
  const selector = `app=${SCOUT_ACTIVITY_WORKER_APP_LABEL}`;
  job.addContainer(
    kubectlScriptContainer(
      "wait-for-activity-worker-termination",
      `
set -euo pipefail
kubectl wait pod --namespace ${namespace} --selector ${selector} --for=delete --timeout=120s
remaining=$(kubectl get pod --namespace ${namespace} --selector ${selector} --output name)
if [ -n "$remaining" ]; then
  echo "Activity-worker pods still present: $remaining" >&2
  exit 1
fi
echo "No activity-worker pod remains; application may reclaim the queues"
`.trim(),
    ),
  );
  return job;
}
