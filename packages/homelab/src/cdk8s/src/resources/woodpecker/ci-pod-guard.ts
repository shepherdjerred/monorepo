import { ApiObject, type Chart } from "cdk8s";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_SYNC_WAVES,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { CI_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { BATCH_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

/**
 * Label Woodpecker's Kubernetes backend stamps on every pod it creates --
 * clone, service, and step alike -- and nothing else carries.
 */
export const WOODPECKER_TASK_LABEL = "woodpecker-ci.org/task-uuid";

/** Resources every CI container must declare, as a request and a limit. */
export const CI_BOUNDED_RESOURCES = [
  "cpu",
  "memory",
  "ephemeral-storage",
] as const;

export const CI_POD_GUARD_POLICY = "woodpecker-ci-pod-guard.sjer.red";

function allContainersBounded(field: "containers" | "initContainers"): string {
  const resources = `[${CI_BOUNDED_RESOURCES.map((name) => `'${name}'`).join(", ")}]`;
  const bounded = `object.spec.${field}.all(c, has(c.resources) && has(c.resources.requests) && has(c.resources.limits) && ${resources}.all(r, r in c.resources.requests && r in c.resources.limits))`;
  return field === "containers"
    ? bounded
    : `!has(object.spec.initContainers) || ${bounded}`;
}

/**
 * Fail-closed admission for pods in the CI namespace.
 *
 * Nothing about a CI pod's shape is enforced by the layer that creates it:
 * placement and priority come from the Woodpecker agent's pod defaults,
 * requests from the configuration extension and the namespace LimitRange.
 * Each of those can regress on its own, and the failure it produces -- CI
 * pods on the production node, or pods Kueue and the scheduler cannot see --
 * is the July 2026 freeze again. This policy turns any such regression into a
 * rejected pod, which fails a step loudly.
 *
 * Validation runs after mutation, so it sees the LimitRange defaults. It
 * checks CREATE only: Kueue's own update to ungate a pod only adds to it.
 */
export function createWoodpeckerCiPodGuard(chart: Chart): void {
  new ApiObject(chart, "woodpecker-ci-pod-guard-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name: CI_POD_GUARD_POLICY,
      annotations: {
        [ARGOCD_SYNC_WAVE_ANNOTATION]: APPLICATION_SYNC_WAVES.admissionPolicy,
      },
    },
    spec: {
      failurePolicy: "Fail",
      matchConstraints: {
        namespaceSelector: {
          matchLabels: {
            "kubernetes.io/metadata.name": WOODPECKER_CI_NAMESPACE,
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
          expression: `has(object.spec.nodeSelector) && 'kubernetes.io/hostname' in object.spec.nodeSelector && object.spec.nodeSelector['kubernetes.io/hostname'] == '${CI_NODE_HOSTNAME}'`,
          message: `CI pods must select the CI node (kubernetes.io/hostname: ${CI_NODE_HOSTNAME})`,
          reason: "Forbidden",
        },
        {
          // Woodpecker's own pods are batch work. The maintenance worker is a
          // long-running service and keeps the default priority.
          expression: `!has(object.metadata.labels) || !('${WOODPECKER_TASK_LABEL}' in object.metadata.labels) || (has(object.spec.priorityClassName) && object.spec.priorityClassName == '${BATCH_PRIORITY}')`,
          message: `Woodpecker CI pods must run at priority class ${BATCH_PRIORITY}`,
          reason: "Forbidden",
        },
        {
          expression: allContainersBounded("containers"),
          message:
            "Every CI container must request and limit cpu, memory, and ephemeral-storage",
          reason: "Forbidden",
        },
        {
          expression: allContainersBounded("initContainers"),
          message:
            "Every CI init container must request and limit cpu, memory, and ephemeral-storage",
          reason: "Forbidden",
        },
      ],
    },
  });

  new ApiObject(chart, "woodpecker-ci-pod-guard-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name: CI_POD_GUARD_POLICY,
      annotations: {
        [ARGOCD_SYNC_WAVE_ANNOTATION]: APPLICATION_SYNC_WAVES.admissionBinding,
      },
    },
    spec: {
      policyName: CI_POD_GUARD_POLICY,
      validationActions: ["Deny"],
    },
  });
}
