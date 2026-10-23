import { ApiObject, type Chart } from "cdk8s";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_LIFECYCLE_ANNOTATION,
  APPLICATION_RESOURCES_FINALIZER,
  APPLICATION_SYNC_WAVES,
  MANAGED_APPLICATION_LABEL,
  ORPHAN_ROOT_ANNOTATION,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";

export const ARGOCD_ADMISSION_POLICY_SYNC_WAVE =
  APPLICATION_SYNC_WAVES.admissionPolicy;
export const ARGOCD_ADMISSION_BINDING_SYNC_WAVE =
  APPLICATION_SYNC_WAVES.admissionBinding;

const APPLICATION_RULES = [
  {
    apiGroups: ["argoproj.io"],
    apiVersions: ["v1alpha1"],
    operations: ["UPDATE"],
    resources: ["applications"],
    scope: "Namespaced",
  },
];

function metadata(name: string, wave: string) {
  return {
    name,
    annotations: { [ARGOCD_SYNC_WAVE_ANNOTATION]: wave },
  };
}

/**
 * The retained root and ArgoCD Applications are never deletable. Under
 * transition rendering the root may be deleted once it is explicitly
 * orphaned: its children are retained without a resources finalizer, so the
 * deletion leaves them in place for their per-service owners.
 */
function retainedDeletionValidation(transition: boolean) {
  if (!transition) {
    return {
      expression:
        "!['apps', 'argocd'].exists(name, name == oldObject.metadata.name)",
      message:
        "retained root and ArgoCD Applications cannot be deleted while the lifecycle policy is active",
      reason: "Forbidden",
    };
  }
  return {
    expression: `oldObject.metadata.name != 'argocd' && (oldObject.metadata.name != 'apps' || (has(oldObject.metadata.annotations) && '${ORPHAN_ROOT_ANNOTATION}' in oldObject.metadata.annotations && oldObject.metadata.annotations['${ORPHAN_ROOT_ANNOTATION}'] == 'true'))`,
    message: `the retained ArgoCD Application cannot be deleted while the lifecycle policy is active, and the root Application only once it carries ${ORPHAN_ROOT_ANNOTATION}=true`,
    reason: "Forbidden",
  };
}

/**
 * The only Kubernetes identities that may write the source of an Application
 * in the ArgoCD namespace. ArgoCD's API server performs every ArgoCD account's writes, so
 * ArgoCD RBAC decides which account (Delivery's, after the window) may reach
 * it; the application controller applies the root's child manifests until the
 * root is orphaned. Every other identity, including a cluster administrator
 * using kubectl, is denied: the break-glass is deleting this policy's binding
 * (see the wiki how-to on ArgoCD access).
 */
export const APPLICATION_SOURCE_WRITERS = [
  "system:serviceaccount:argocd:argocd-server",
  "system:serviceaccount:argocd:argocd-application-controller",
] as const;
export const APPLICATION_SOURCE_POLICY = "argocd-application-source.sjer.red";

const SOURCE_FIELDS = ["source", "sources"] as const;

function sourceChanged(): string {
  return SOURCE_FIELDS.map(
    (field) =>
      `(has(object.spec.${field}) != has(oldObject.spec.${field}) || (has(object.spec.${field}) && object.spec.${field} != oldObject.spec.${field}))`,
  ).join(" || ");
}

function createApplicationSourcePolicy(chart: Chart): void {
  new ApiObject(chart, "argocd-application-source-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: metadata(
      APPLICATION_SOURCE_POLICY,
      ARGOCD_ADMISSION_POLICY_SYNC_WAVE,
    ),
    spec: {
      failurePolicy: "Fail",
      // Every Application in the ArgoCD namespace, with no object selector:
      // the root carries no managed label, and a label is mutable, so a
      // selector could be escaped by first removing it.
      matchConstraints: {
        matchPolicy: "Equivalent",
        namespaceSelector: {},
        resourceRules: [
          { ...APPLICATION_RULES[0], operations: ["CREATE", "UPDATE"] },
        ],
      },
      matchConditions: [
        {
          name: "argocd-namespace",
          expression: "request.namespace == 'argocd'",
        },
        {
          name: "source-written",
          expression: `request.operation == 'CREATE' || ${sourceChanged()}`,
        },
      ],
      validations: [
        {
          expression: `[${APPLICATION_SOURCE_WRITERS.map((writer) => `'${writer}'`).join(", ")}].exists(writer, writer == request.userInfo.username)`,
          message:
            "only Delivery, through ArgoCD, writes an Application's source",
          reason: "Forbidden",
        },
      ],
    },
  });
  new ApiObject(chart, "argocd-application-source-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: metadata(
      APPLICATION_SOURCE_POLICY,
      ARGOCD_ADMISSION_BINDING_SYNC_WAVE,
    ),
    spec: {
      policyName: APPLICATION_SOURCE_POLICY,
      validationActions: ["Deny"],
    },
  });
}

export function createArgoCdApplicationAdmissionPolicies(
  chart: Chart,
  transition: boolean = transitionRendering(),
): void {
  const mutationPolicyName = "argocd-application-sync-options.sjer.red";
  new ApiObject(chart, "argocd-application-sync-options-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicy",
    metadata: metadata(mutationPolicyName, ARGOCD_ADMISSION_POLICY_SYNC_WAVE),
    spec: {
      failurePolicy: "Fail",
      reinvocationPolicy: "IfNeeded",
      matchConstraints: {
        matchPolicy: "Equivalent",
        namespaceSelector: {},
        objectSelector: {
          matchLabels: { [MANAGED_APPLICATION_LABEL]: "true" },
        },
        resourceRules: APPLICATION_RULES,
      },
      matchConditions: [
        {
          name: "manual-sync-with-declared-options",
          expression:
            "has(object.operation) && has(object.operation.sync) && has(object.spec.syncPolicy) && has(object.spec.syncPolicy.syncOptions) && size(object.spec.syncPolicy.syncOptions) > 0",
        },
      ],
      variables: [
        {
          name: "declaredOptions",
          expression: "object.spec.syncPolicy.syncOptions",
        },
        {
          name: "requestedOptions",
          expression:
            "has(object.operation.sync.syncOptions) ? object.operation.sync.syncOptions : []",
        },
        {
          name: "declaredKeys",
          expression:
            "variables.declaredOptions.map(option, option.split('=')[0])",
        },
        {
          name: "mergedOptions",
          expression:
            "variables.requestedOptions.filter(option, !variables.declaredKeys.exists(key, option == key || option.startsWith(key + '='))) + variables.declaredOptions",
        },
      ],
      mutations: [
        {
          patchType: "JSONPatch",
          jsonPatch: {
            expression:
              "[JSONPatch{op: has(object.operation.sync.syncOptions) ? 'replace' : 'add', path: '/operation/sync/syncOptions', value: variables.mergedOptions}]",
          },
        },
      ],
    },
  });

  new ApiObject(chart, "argocd-application-sync-options-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicyBinding",
    metadata: metadata(mutationPolicyName, ARGOCD_ADMISSION_BINDING_SYNC_WAVE),
    spec: { policyName: mutationPolicyName },
  });

  const validationPolicyName = "argocd-application-lifecycle.sjer.red";
  new ApiObject(chart, "argocd-application-lifecycle-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: metadata(validationPolicyName, ARGOCD_ADMISSION_POLICY_SYNC_WAVE),
    spec: {
      failurePolicy: "Fail",
      matchConstraints: {
        matchPolicy: "Equivalent",
        namespaceSelector: {},
        resourceRules: [
          {
            ...APPLICATION_RULES[0],
            operations: ["DELETE"],
          },
        ],
      },
      matchConditions: [
        {
          name: "argocd-namespace",
          expression: "request.namespace == 'argocd'",
        },
        // The retain-or-cascade contract only covers Applications this
        // repository renders. The root Application carries no managed label
        // (the sync-option mutation must not reach it), so it is named
        // explicitly instead. An ad-hoc or externally managed Application stays
        // deletable.
        {
          name: "release-managed-application",
          expression: `['apps', 'argocd'].exists(name, name == oldObject.metadata.name) || (has(oldObject.metadata.labels) && '${MANAGED_APPLICATION_LABEL}' in oldObject.metadata.labels && oldObject.metadata.labels['${MANAGED_APPLICATION_LABEL}'] == 'true')`,
        },
      ],
      validations: [
        retainedDeletionValidation(transition),
        {
          expression: `['apps', 'argocd'].exists(name, name == oldObject.metadata.name) || (has(oldObject.metadata.annotations) && oldObject.metadata.annotations['${APPLICATION_LIFECYCLE_ANNOTATION}'] == 'cascade' && has(oldObject.metadata.finalizers) && oldObject.metadata.finalizers.exists(finalizer, finalizer == '${APPLICATION_RESOURCES_FINALIZER}'))`,
          message:
            "deleting an Application requires the cascade lifecycle annotation and ArgoCD resources finalizer",
          reason: "Invalid",
        },
      ],
    },
  });

  new ApiObject(chart, "argocd-application-lifecycle-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: metadata(
      validationPolicyName,
      ARGOCD_ADMISSION_BINDING_SYNC_WAVE,
    ),
    spec: {
      policyName: validationPolicyName,
      validationActions: ["Deny"],
    },
  });

  if (transition) createApplicationSourcePolicy(chart);
}
