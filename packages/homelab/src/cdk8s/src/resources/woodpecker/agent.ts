import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Node,
  NodeLabelQuery,
  Secret,
  ServiceAccount,
} from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
  KubeServiceAccount,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  CI_NODE_HOSTNAME,
  CI_NODE_TOLERATION,
  ciNodeTaintedNode,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { BATCH_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { CI_WORKSPACE_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  WOODPECKER_GRPC_PORT,
  WOODPECKER_MAX_WORKFLOWS,
} from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";
import {
  WOODPECKER_CI_NAMESPACE,
  WOODPECKER_NAMESPACE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

/**
 * RBAC for the agent's Kubernetes backend.
 *
 * For each workflow the agent creates a workspace claim and a headless Service
 * (which is how a step reaches its services by name), then one pod per clone,
 * service, and step, and streams their logs back. The agent itself runs in the
 * control-plane namespace but is granted nothing there: its Role exists only
 * in the CI namespace, and step pods run under the tokenless `woodpecker-job`
 * account with no API access at all.
 */
function createAgentRbac(chart: Chart): KubeServiceAccount {
  const serviceAccount = new KubeServiceAccount(chart, "woodpecker-agent-sa", {
    metadata: { name: "woodpecker-agent", namespace: WOODPECKER_NAMESPACE },
  });

  const role = new KubeRole(chart, "woodpecker-agent-role", {
    metadata: { name: "woodpecker-agent", namespace: WOODPECKER_CI_NAMESPACE },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods", "pods/log"],
        verbs: ["get", "list", "watch", "create", "delete", "update"],
      },
      {
        apiGroups: [""],
        resources: ["persistentvolumeclaims", "services"],
        verbs: ["get", "list", "watch", "create", "delete"],
      },
    ],
  });

  new KubeRoleBinding(chart, "woodpecker-agent-rolebinding", {
    metadata: { name: "woodpecker-agent", namespace: WOODPECKER_CI_NAMESPACE },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: role.name,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: WOODPECKER_NAMESPACE,
      },
    ],
  });

  return serviceAccount;
}

export function createWoodpeckerAgent(chart: Chart) {
  const serviceAccount = createAgentRbac(chart);

  const serverSecretRef = Secret.fromSecretName(
    chart,
    "woodpecker-agent-secret-ref",
    "woodpecker-server-credentials",
  );

  const deployment = new Deployment(chart, "woodpecker-agent", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    podMetadata: { labels: { app: "woodpecker-agent" } },
    serviceAccount: ServiceAccount.fromServiceAccountName(
      chart,
      "woodpecker-agent-sa-ref",
      serviceAccount.name,
    ),
  });

  // CI runs ONLY on the dedicated CI node: the toleration admits it past
  // liskov's ci=only:NoSchedule taint and the attraction keeps it off the
  // production node. If liskov is down, CI stays pending rather than
  // displacing production workloads.
  deployment.scheduling.attract(
    Node.labeled(NodeLabelQuery.is("kubernetes.io/hostname", CI_NODE_HOSTNAME)),
  );
  deployment.scheduling.tolerate(ciNodeTaintedNode());

  deployment.addContainer(
    withCommonProps({
      name: "woodpecker-agent",
      image: `woodpeckerci/woodpecker-agent:${versions["woodpeckerci/woodpecker-agent"]}`,
      envVariables: {
        WOODPECKER_SERVER: EnvValue.fromValue(
          `woodpecker-server:${WOODPECKER_GRPC_PORT.toString()}`,
        ),
        WOODPECKER_AGENT_SECRET: EnvValue.fromSecretValue({
          secret: serverSecretRef,
          key: "WOODPECKER_AGENT_SECRET",
        }),
        WOODPECKER_BACKEND: EnvValue.fromValue("kubernetes"),
        WOODPECKER_BACKEND_K8S_NAMESPACE: EnvValue.fromValue(
          WOODPECKER_CI_NAMESPACE,
        ),
        // Cluster-wide concurrency bound; successor to the agent stack's
        // count-based max-in-flight cap.
        WOODPECKER_MAX_WORKFLOWS: EnvValue.fromValue(
          WOODPECKER_MAX_WORKFLOWS.toString(),
        ),

        // Steps reference existing Kubernetes Secrets by exact key through
        // `backend_options.kubernetes.secrets`. This preserves the per-step
        // grant boundary the Buildkite pipeline enforced with `secretKeyRef`,
        // and keeps credentials in 1Password-synced Secrets instead of
        // Woodpecker's own secret store.
        //
        // SECURITY: this lets anyone who can push a branch reference any
        // Secret in this namespace. That is acceptable only because the
        // instance is single-tenant and fork pipelines require approval
        // before they run.
        WOODPECKER_BACKEND_K8S_ALLOW_NATIVE_SECRETS: EnvValue.fromValue("true"),

        // Step pods declare their own pod shape: resource tier, node pinning,
        // tolerations, and the tokenless service account. Each of these is
        // off by default because it is an escalation surface on a shared
        // instance; the same single-tenant reasoning applies.
        WOODPECKER_BACKEND_K8S_POD_TOLERATIONS_ALLOW_FROM_STEP:
          EnvValue.fromValue("true"),
        WOODPECKER_BACKEND_K8S_POD_NODE_SELECTOR_ALLOW_FROM_STEP:
          EnvValue.fromValue("true"),
        WOODPECKER_BACKEND_K8S_SERVICE_ACCOUNT_NAME_ALLOW_FROM_STEP:
          EnvValue.fromValue("true"),
        WOODPECKER_BACKEND_K8S_POD_LABELS_ALLOW_FROM_STEP:
          EnvValue.fromValue("true"),
        WOODPECKER_BACKEND_K8S_POD_ANNOTATIONS_ALLOW_FROM_STEP:
          EnvValue.fromValue("true"),

        // Pod defaults. These are the only settings that reach the clone pod
        // and service pods, which carry none of a step's backend options:
        // without them the clone lands on the production node, and the
        // workspace claim binds there with it. The CI namespace's admission
        // policy rejects any pod that arrives without them.
        WOODPECKER_BACKEND_K8S_POD_NODE_SELECTOR: EnvValue.fromValue(
          JSON.stringify({ "kubernetes.io/hostname": CI_NODE_HOSTNAME }),
        ),
        WOODPECKER_BACKEND_K8S_POD_TOLERATIONS: EnvValue.fromValue(
          JSON.stringify([CI_NODE_TOLERATION]),
        ),
        // CI is the first thing to give way under node pressure.
        WOODPECKER_BACKEND_K8S_PRIORITY_CLASS:
          EnvValue.fromValue(BATCH_PRIORITY),

        // Per-workflow workspace claims land on the CI node's NVMe and are
        // destroyed with the workflow.
        WOODPECKER_BACKEND_K8S_STORAGE_CLASS: EnvValue.fromValue(
          CI_WORKSPACE_STORAGE_CLASS,
        ),
        WOODPECKER_BACKEND_K8S_STORAGE_RWX: EnvValue.fromValue("true"),
        WOODPECKER_BACKEND_K8S_VOLUME_SIZE: EnvValue.fromValue("16G"),
      },
      securityContext: {
        ensureNonRoot: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: { request: Cpu.millis(100), limit: Cpu.millis(1000) },
        memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  return { deployment, serviceAccount };
}
