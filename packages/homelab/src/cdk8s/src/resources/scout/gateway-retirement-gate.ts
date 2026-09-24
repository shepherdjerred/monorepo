import type { Chart } from "cdk8s";
import { Duration } from "cdk8s";
import { Job, ServiceAccount } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { kubectlScriptContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/kubectl-script-container.ts";
import { ARGOCD_SYNC_WAVE_ANNOTATION } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import {
  SCOUT_GATEWAY_APP_LABEL,
  SCOUT_GATEWAY_SYNC_WAVE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/gateway.ts";

/** Name shared by the gate's Job, ServiceAccount, Role and RoleBinding. */
export const SCOUT_GATEWAY_RETIREMENT_GATE_NAME =
  "scout-gateway-retirement-gate";

/**
 * The retirement sync's ordering, end to end.
 *
 * The backend Deployment carries no sync-wave annotation, so it is in wave 0,
 * and its Recreate rollout back to `combined` is what opens a Discord session.
 * Everything that has to happen before that sits in a negative wave:
 *
 * - `-3` the gate's ServiceAccount, Role, RoleBinding and NetworkPolicy, so
 *   they exist before the Job's pod is admitted;
 * - `-2` the gateway Deployment's scale-to-zero
 *   (`SCOUT_GATEWAY_SYNC_WAVE.retiring`), which ArgoCD reports Healthy once
 *   the ReplicaSet has marked the last pod for deletion — not once that pod
 *   has exited;
 * - `-1` this Job, which does not complete until no gateway pod exists.
 *
 * The gateway Deployment and the Job are in separate waves on purpose. Within
 * one wave ArgoCD applies every task before it waits on any of them, so a Job
 * sharing the Deployment's wave could list pods before the scale-down had been
 * applied at all. A separate wave makes "the scale-down is applied and its
 * ReplicaSet has acted on it" a precondition of the wait starting.
 */
const SCOUT_GATEWAY_RETIREMENT_SYNC_WAVES = {
  gatePrerequisites: "-3",
  gatewayScaleDown: SCOUT_GATEWAY_SYNC_WAVE.retiring,
  gate: "-1",
} as const;

/**
 * How long the gate waits for the gateway pod to go.
 *
 * The gateway's `terminationGracePeriod` is 45s, after which the kubelet
 * kills the container and the pod object is removed. 120s is that grace
 * period with room for the kubelet's own reporting lag, and still leaves most
 * of `release-root`'s default 300s child-sync budget for the backend's rollout
 * in wave 0. Exceeding it means the pod is stuck, which is exactly when the
 * backend must not start: the Job fails and the sync fails with it.
 */
const GATE_WAIT_TIMEOUT_SECONDS = 120;

/**
 * The Sync-hook annotations every gate resource carries.
 *
 * A hook rather than a plain resource because a plain Job under this
 * Application would be a managed resource that ArgoCD applies once and then
 * reports as Synced forever: a completed Job does not re-run on the next sync,
 * and its immutable pod template would make any later edit an apply failure.
 * A Sync hook is recreated on every sync (`BeforeHookCreation`), so each
 * retirement sync runs its own check.
 *
 * `HookSucceeded` deletes the gate after a successful operation — ArgoCD
 * deletes succeeded hooks only once the whole operation has succeeded, so the
 * RBAC in wave -3 is still present when the Job in wave -1 runs. Hook
 * resources are never pruned, so without this policy the gate would outlive
 * the `absent` change that retires the rest of the gateway. A failed gate is
 * kept for its logs until the next sync recreates it.
 */
function hookAnnotations(wave: string) {
  return {
    "argocd.argoproj.io/hook": "Sync",
    "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation,HookSucceeded",
    [ARGOCD_SYNC_WAVE_ANNOTATION]: wave,
  };
}

/**
 * Selects the gateway role's pods and nothing else.
 *
 * Matches on the `app` label alone because that is the label the gateway's
 * Service, ServiceMonitor and NetworkPolicy already select on. The gate's own
 * pod is labelled {@link SCOUT_GATEWAY_RETIREMENT_GATE_NAME}, which this does
 * not match — a gate that selected itself would wait on its own deletion.
 */
export const SCOUT_GATEWAY_POD_SELECTOR = `app=${SCOUT_GATEWAY_APP_LABEL}`;

function gateScript(namespace: string): string {
  return String.raw`
set -euo pipefail

echo "Waiting for pods matching ${SCOUT_GATEWAY_POD_SELECTOR} in ${namespace} to be deleted"
# --for=delete succeeds immediately when nothing matches, which is the steady
# state for every retirement sync after the first. On timeout kubectl exits
# non-zero and the Job fails, failing the sync before wave 0.
kubectl wait pod \
  --namespace ${namespace} \
  --selector ${SCOUT_GATEWAY_POD_SELECTOR} \
  --for=delete \
  --timeout=${GATE_WAIT_TIMEOUT_SECONDS.toString()}s

# kubectl wait resolves the matching set once, at start. Re-list so a pod
# created after that point cannot slip past the gate unobserved.
remaining=$(kubectl get pod \
  --namespace ${namespace} \
  --selector ${SCOUT_GATEWAY_POD_SELECTOR} \
  --output name)
if [ -n "$remaining" ]; then
  echo "Gateway pods still present after the wait: $remaining" >&2
  exit 1
fi

echo "No gateway pod remains; the Discord token is released"
`.trim();
}

/**
 * The retirement gate: a Sync hook that holds the sync between the gateway's
 * scale-to-zero and the backend's return to `combined` until no gateway pod
 * exists.
 *
 * ## Why this is needed
 *
 * Wave ordering alone orders the apply, not the termination. ArgoCD judges a
 * Deployment Healthy from its status, and the ReplicaSet's replica count
 * excludes pods that are already terminating. So a zero-replica gateway
 * Deployment reports Healthy while its last pod is still inside its 45s grace
 * period and still logged in to Discord, ArgoCD advances to wave 0, and the
 * backend's `combined` pod opens a second session on the same token.
 *
 * A pod object is removed from the API only after the kubelet has confirmed its
 * containers stopped, so "no pod matches the gateway selector" is the precise
 * claim that the process holding the token has exited.
 *
 * ## Why a Job and not a startup check in the backend
 *
 * A backend-side lease on the Discord identity would also cover syncs that
 * bypass hooks (a selective `--resource` sync) and a hand-run `kubectl scale`.
 * It is not done here because it is a runtime contract change in
 * `packages/scout-for-lol` with its own RBAC or database lock, for a state that
 * exists only for one rollback. The gate covers every path that runs hooks:
 * `release-root`'s full-source child sync and an ordinary manual sync.
 */
export function createScoutGatewayRetirementGate(chart: Chart, stage: Stage) {
  const namespace = `scout-${stage}`;
  const prerequisiteAnnotations = hookAnnotations(
    SCOUT_GATEWAY_RETIREMENT_SYNC_WAVES.gatePrerequisites,
  );

  const serviceAccount = new ServiceAccount(
    chart,
    "scout-gateway-retirement-gate-service-account",
    {
      metadata: {
        name: SCOUT_GATEWAY_RETIREMENT_GATE_NAME,
        annotations: prerequisiteAnnotations,
      },
    },
  );

  // Read-only on pods in this namespace and nothing else: `kubectl wait` lists
  // and watches, and a named pod read is a get.
  new KubeRole(chart, "scout-gateway-retirement-gate-role", {
    metadata: {
      name: SCOUT_GATEWAY_RETIREMENT_GATE_NAME,
      annotations: prerequisiteAnnotations,
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods"],
        verbs: ["get", "list", "watch"],
      },
    ],
  });

  new KubeRoleBinding(chart, "scout-gateway-retirement-gate-role-binding", {
    metadata: {
      name: SCOUT_GATEWAY_RETIREMENT_GATE_NAME,
      annotations: prerequisiteAnnotations,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: SCOUT_GATEWAY_RETIREMENT_GATE_NAME,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace,
      },
    ],
  });

  // Only the Kubernetes API. No policy in this namespace selects the gate's
  // pod otherwise, so without this it would have unrestricted egress. kubectl
  // reaches the API through KUBERNETES_SERVICE_HOST, an IP, so it needs no DNS;
  // 6443 is the API server's endpoint port after the Service is translated,
  // matching the temporal backup preflight's policy.
  new KubeNetworkPolicy(chart, "scout-gateway-retirement-gate-netpol", {
    metadata: {
      name: `${SCOUT_GATEWAY_RETIREMENT_GATE_NAME}-netpol`,
      annotations: prerequisiteAnnotations,
    },
    spec: {
      podSelector: {
        matchLabels: { app: SCOUT_GATEWAY_RETIREMENT_GATE_NAME },
      },
      policyTypes: ["Ingress", "Egress"],
      egress: [
        { ports: [{ port: IntOrString.fromNumber(6443), protocol: "TCP" }] },
      ],
    },
  });

  const job = new Job(chart, "scout-gateway-retirement-gate", {
    metadata: {
      name: SCOUT_GATEWAY_RETIREMENT_GATE_NAME,
      annotations: hookAnnotations(SCOUT_GATEWAY_RETIREMENT_SYNC_WAVES.gate),
    },
    serviceAccount,
    // The script is all kubectl. cdk8s-plus defaults this to false, and
    // without a projected token kubectl falls back to localhost:8080.
    automountServiceAccountToken: true,
    // No retry: a timed-out wait means the pod is stuck, and a second attempt
    // would only spend the rest of the child-sync budget re-confirming it.
    backoffLimit: 0,
    activeDeadline: Duration.seconds(GATE_WAIT_TIMEOUT_SECONDS + 30),
    podMetadata: { labels: { app: SCOUT_GATEWAY_RETIREMENT_GATE_NAME } },
  });

  job.addContainer(
    kubectlScriptContainer(
      "wait-for-gateway-termination",
      gateScript(namespace),
    ),
  );

  return job;
}
