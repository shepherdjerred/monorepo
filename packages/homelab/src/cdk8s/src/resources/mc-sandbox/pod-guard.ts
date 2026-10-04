import { ApiObject, type Chart } from "cdk8s";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_SYNC_WAVES,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import {
  CI_NODE_HOSTNAME,
  CI_NODE_TOLERATION,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { BATCH_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import {
  MC_HARNESS_EXPIRES_AT_ANNOTATION,
  MC_HARNESS_MANAGED_BY,
  MC_SANDBOX_MAX_DEADLINE_SECONDS,
  MC_SANDBOX_NAMESPACE,
  mcSandboxImageAllowlist,
} from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/constants.ts";

export const MC_SANDBOX_POD_GUARD_POLICY = "mc-sandbox-pod-guard.sjer.red";

const BOUNDED_RESOURCES = ["cpu", "memory", "ephemeral-storage"] as const;

function celList(values: readonly string[]): string {
  return `[${values.map((value) => `'${value}'`).join(", ")}]`;
}

/** CEL: every container in `field` satisfies `predicate` (over `c`). */
function everyContainer(
  field: "containers" | "initContainers",
  predicate: string,
): string {
  const all = `object.spec.${field}.all(c, ${predicate})`;
  return field === "containers"
    ? all
    : `!has(object.spec.initContainers) || ${all}`;
}

const BOUNDED = `has(c.resources) && has(c.resources.requests) && has(c.resources.limits) && ${celList(BOUNDED_RESOURCES)}.all(r, r in c.resources.requests && r in c.resources.limits)`;

/**
 * Fail-closed admission for pods in the sandbox namespace, modelled on the CI
 * pod guard (`woodpecker/ci-pod-guard.ts`). The harness builds conforming
 * pods; this turns any regression, or any pod not created by the harness,
 * into a rejected create instead of an unbounded or long-lived workload.
 *
 * Flannel does not enforce NetworkPolicy, and CronJobs are not allowed, so
 * the guard is the enforceable boundary: harness ownership, a TTL the daemon
 * reaps by plus a kubelet-enforced deadline, CI-node placement at batch
 * priority, bounded resources, pinned images only, and no PVCs (sandbox state
 * is disposable emptyDir).
 */
export function createMcSandboxPodGuard(chart: Chart): void {
  const images = celList(mcSandboxImageAllowlist());
  new ApiObject(chart, "mc-sandbox-pod-guard-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name: MC_SANDBOX_POD_GUARD_POLICY,
      annotations: {
        [ARGOCD_SYNC_WAVE_ANNOTATION]: APPLICATION_SYNC_WAVES.admissionPolicy,
      },
    },
    spec: {
      failurePolicy: "Fail",
      matchConstraints: {
        namespaceSelector: {
          matchLabels: {
            "kubernetes.io/metadata.name": MC_SANDBOX_NAMESPACE,
          },
        },
        resourceRules: [
          {
            apiGroups: [""],
            apiVersions: ["v1"],
            operations: ["CREATE"],
            resources: ["pods"],
          },
        ],
      },
      validations: [
        {
          expression: `has(object.metadata.labels) && 'app.kubernetes.io/managed-by' in object.metadata.labels && object.metadata.labels['app.kubernetes.io/managed-by'] == '${MC_HARNESS_MANAGED_BY}'`,
          message: `Sandbox pods must be created by the harness (app.kubernetes.io/managed-by: ${MC_HARNESS_MANAGED_BY})`,
          reason: "Forbidden",
        },
        {
          expression: `has(object.metadata.annotations) && '${MC_HARNESS_EXPIRES_AT_ANNOTATION}' in object.metadata.annotations`,
          message: `Sandbox pods must carry a ${MC_HARNESS_EXPIRES_AT_ANNOTATION} annotation`,
          reason: "Forbidden",
        },
        {
          expression: `has(object.spec.activeDeadlineSeconds) && object.spec.activeDeadlineSeconds <= ${MC_SANDBOX_MAX_DEADLINE_SECONDS.toString()}`,
          message: `Sandbox pods must set activeDeadlineSeconds of at most ${MC_SANDBOX_MAX_DEADLINE_SECONDS.toString()}`,
          reason: "Forbidden",
        },
        {
          expression: `has(object.spec.priorityClassName) && object.spec.priorityClassName == '${BATCH_PRIORITY}'`,
          message: `Sandbox pods must run at priority class ${BATCH_PRIORITY}`,
          reason: "Forbidden",
        },
        {
          expression: `has(object.spec.nodeSelector) && 'kubernetes.io/hostname' in object.spec.nodeSelector && object.spec.nodeSelector['kubernetes.io/hostname'] == '${CI_NODE_HOSTNAME}' && has(object.spec.tolerations) && object.spec.tolerations.exists(t, has(t.key) && t.key == '${CI_NODE_TOLERATION.key}' && has(t.value) && t.value == '${CI_NODE_TOLERATION.value}' && has(t.effect) && t.effect == '${CI_NODE_TOLERATION.effect}')`,
          message: `Sandbox pods must select and tolerate the CI node (${CI_NODE_HOSTNAME})`,
          reason: "Forbidden",
        },
        {
          expression: everyContainer("containers", BOUNDED),
          message:
            "Every sandbox container must request and limit cpu, memory, and ephemeral-storage",
          reason: "Forbidden",
        },
        {
          expression: everyContainer("initContainers", BOUNDED),
          message:
            "Every sandbox init container must request and limit cpu, memory, and ephemeral-storage",
          reason: "Forbidden",
        },
        {
          expression: `${everyContainer("containers", `c.image in ${images}`)} && (${everyContainer("initContainers", `c.image in ${images}`)})`,
          message:
            "Sandbox pods may only run the catalog-pinned itzg/minecraft-server or the-storm-server images",
          reason: "Forbidden",
        },
        {
          expression:
            "!has(object.spec.volumes) || object.spec.volumes.all(v, !has(v.persistentVolumeClaim))",
          message:
            "Sandbox pods use emptyDir only, never PersistentVolumeClaims",
          reason: "Forbidden",
        },
      ],
    },
  });

  new ApiObject(chart, "mc-sandbox-pod-guard-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name: MC_SANDBOX_POD_GUARD_POLICY,
      annotations: {
        [ARGOCD_SYNC_WAVE_ANNOTATION]: APPLICATION_SYNC_WAVES.admissionBinding,
      },
    },
    spec: {
      policyName: MC_SANDBOX_POD_GUARD_POLICY,
      validationActions: ["Deny"],
    },
  });
}
