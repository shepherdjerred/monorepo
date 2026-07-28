import { ApiObject, type Chart } from "cdk8s";
import {
  PVC_BACKUP_POLICY,
  pvcBackupPolicyKey,
} from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";

const INCLUDED_PVC_KEYS = PVC_BACKUP_POLICY.filter(
  (entry) => entry.backup === "enabled",
).map((entry) => pvcBackupPolicyKey(entry.namespace, entry.name));

const EXCLUDED_PVC_KEYS = PVC_BACKUP_POLICY.filter(
  (entry) => entry.backup === "disabled",
).map((entry) => pvcBackupPolicyKey(entry.namespace, entry.name));

function toCelList(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

const POLICY_KEY_EXPRESSION =
  "object.metadata.namespace + '/' + object.metadata.name";
const INCLUDED_EXPRESSION = `${toCelList(INCLUDED_PVC_KEYS)}.exists(key, key == variables.policyKey)`;
const EXCLUDED_EXPRESSION = `${toCelList(EXCLUDED_PVC_KEYS)}.exists(key, key == variables.policyKey)`;

const PVC_MATCH_CONSTRAINTS = {
  matchPolicy: "Equivalent",
  namespaceSelector: {},
  objectSelector: {},
  resourceRules: [
    {
      apiGroups: [""],
      apiVersions: ["v1"],
      operations: ["CREATE", "UPDATE"],
      resources: ["persistentvolumeclaims"],
      scope: "Namespaced",
    },
  ],
};

function createMutationPolicy(
  chart: Chart,
  disposition: "included" | "excluded",
): void {
  const enabled = disposition === "included";
  const policyName = `pvc-backup-${disposition}.sjer.red`;
  new ApiObject(chart, `pvc-backup-${disposition}-mutation-policy`, {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicy",
    metadata: {
      name: policyName,
    },
    spec: {
      failurePolicy: "Fail",
      reinvocationPolicy: "IfNeeded",
      matchConstraints: PVC_MATCH_CONSTRAINTS,
      matchConditions: [
        {
          name: `is-${disposition}`,
          expression: enabled
            ? INCLUDED_EXPRESSION.replaceAll(
                "variables.policyKey",
                POLICY_KEY_EXPRESSION,
              )
            : EXCLUDED_EXPRESSION.replaceAll(
                "variables.policyKey",
                POLICY_KEY_EXPRESSION,
              ),
        },
      ],
      mutations: [
        {
          patchType: "ApplyConfiguration",
          applyConfiguration: {
            expression: `Object{metadata: Object.metadata{labels: {'velero.io/backup': '${enabled ? "enabled" : "disabled"}', 'velero.io/exclude-from-backup': '${enabled ? "false" : "true"}'}}}`,
          },
        },
      ],
    },
  });

  new ApiObject(chart, `pvc-backup-${disposition}-mutation-binding`, {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicyBinding",
    metadata: {
      name: policyName,
    },
    spec: {
      policyName,
    },
  });
}

export function createPvcBackupAdmissionPolicies(chart: Chart): void {
  createMutationPolicy(chart, "included");
  createMutationPolicy(chart, "excluded");

  const policyName = "pvc-backup-policy.sjer.red";
  new ApiObject(chart, "pvc-backup-validation-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name: policyName,
    },
    spec: {
      failurePolicy: "Fail",
      matchConstraints: PVC_MATCH_CONSTRAINTS,
      // A PVC that is already terminating cannot be restored by an update.
      // Skip validation so Kubernetes controllers and operators can remove
      // finalizers even after the retired claim leaves the policy catalog.
      matchConditions: [
        {
          name: "not-terminating",
          expression: "object.metadata.deletionTimestamp == null",
        },
      ],
      variables: [
        {
          name: "policyKey",
          expression: POLICY_KEY_EXPRESSION,
        },
        {
          name: "included",
          expression: INCLUDED_EXPRESSION,
        },
        {
          name: "excluded",
          expression: EXCLUDED_EXPRESSION,
        },
      ],
      validations: [
        {
          expression: "variables.included || variables.excluded",
          message:
            "PVC is absent from the explicit backup policy; classify it before creation or update",
          reason: "Forbidden",
        },
        {
          expression:
            "!variables.included || (object.metadata.labels['velero.io/backup'] == 'enabled' && object.metadata.labels['velero.io/exclude-from-backup'] == 'false')",
          message:
            "Included PVC must have the enabled Velero backup label pair",
          reason: "Invalid",
        },
        {
          expression:
            "!variables.excluded || (object.metadata.labels['velero.io/backup'] == 'disabled' && object.metadata.labels['velero.io/exclude-from-backup'] == 'true')",
          message:
            "Excluded PVC must have the disabled Velero backup label pair",
          reason: "Invalid",
        },
      ],
    },
  });

  new ApiObject(chart, "pvc-backup-validation-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name: policyName,
    },
    spec: {
      policyName,
      validationActions: ["Deny"],
    },
  });
}
