import { ApiObject, type Chart } from "cdk8s";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_LIFECYCLE_ANNOTATION,
  APPLICATION_RESOURCES_FINALIZER,
  APPLICATION_SYNC_WAVES,
  MANAGED_APPLICATION_LABEL,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";

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

export function createArgoCdApplicationAdmissionPolicies(chart: Chart): void {
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
        {
          expression:
            "!['apps', 'argocd'].exists(name, name == oldObject.metadata.name)",
          message:
            "retained root and ArgoCD Applications cannot be deleted while the lifecycle policy is active",
          reason: "Forbidden",
        },
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
}
