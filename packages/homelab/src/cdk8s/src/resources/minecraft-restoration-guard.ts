import { ApiObject, type Chart } from "cdk8s";
import { minecraftMaintenanceMatch } from "./minecraft-maintenance-match.ts";

export const RESTORE_LEASE_ANNOTATION = "sjer.red/world-restore-lease";
export const RESTORE_PHASE_ANNOTATION = "sjer.red/world-restore-phase";
export const RESTORE_IMAGE_ANNOTATION = "sjer.red/world-restore-image";
export const RESTORE_ACCESS_SELECTOR = "sjer.red/world-restore-access";

/** A world restoration and the scheduled mining reset must never share the production PVC. */
export function createMinecraftRestorationGuard(chart: Chart): void {
  const policyName = "minecraft-tsmc-world-restoration.sjer.red";
  const annotations = "object.metadata.annotations";
  const leased = `has(${annotations}) && '${RESTORE_LEASE_ANNOTATION}' in ${annotations}`;
  const priorAnnotations = "oldObject.metadata.annotations";
  const priorLeased = `has(${priorAnnotations}) && '${RESTORE_LEASE_ANNOTATION}' in ${priorAnnotations}`;
  const phase = `${annotations}['${RESTORE_PHASE_ANNOTATION}']`;
  new ApiObject(chart, "minecraft-tsmc-restoration-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name: policyName,
      annotations: { "argocd.argoproj.io/sync-wave": "-30" },
    },
    spec: {
      ...minecraftMaintenanceMatch("statefulsets"),
      validations: [
        {
          expression: `!(${priorLeased}) || ((${leased}) && ${annotations}['${RESTORE_LEASE_ANNOTATION}'] == ${priorAnnotations}['${RESTORE_LEASE_ANNOTATION}']) || (oldObject.spec.replicas == 0 && object.spec.replicas == 0 && '${RESTORE_PHASE_ANNOTATION}' in ${priorAnnotations} && ${priorAnnotations}['${RESTORE_PHASE_ANNOTATION}'] == 'OFFLINE' && (!has(${annotations}) || (!('${RESTORE_LEASE_ANNOTATION}' in ${annotations}) && !('${RESTORE_PHASE_ANNOTATION}' in ${annotations}) && !('${RESTORE_IMAGE_ANNOTATION}' in ${annotations}))))`,
          message:
            "Keep the restoration lease owner until an explicit stopped release",
          reason: "Forbidden",
        },
        {
          expression: `!(${leased}) || !('sjer.red/mining-reset-lock' in ${annotations})`,
          message:
            "World restoration and mining reset leases are mutually exclusive",
          reason: "Forbidden",
        },
        {
          expression: `!(${leased}) || ('${RESTORE_PHASE_ANNOTATION}' in ${annotations} && ${phase} in ['OFFLINE', 'VALIDATING'] && '${RESTORE_IMAGE_ANNOTATION}' in ${annotations})`,
          message:
            "A world restoration lease requires its phase and pinned image",
          reason: "Forbidden",
        },
        {
          expression: `!(${leased}) || object.spec.replicas == 0 || ('${RESTORE_PHASE_ANNOTATION}' in ${annotations} && ${phase} == 'VALIDATING' && object.spec.replicas == 1 && object.spec.template.spec.containers.size() == 1 && object.spec.template.spec.containers[0].image == ${annotations}['${RESTORE_IMAGE_ANNOTATION}'])`,
          message:
            "World restoration holds the server offline except for its pinned private acceptance image",
          reason: "Forbidden",
        },
        {
          expression: `!(${leased}) || (has(oldObject.metadata.annotations) && '${RESTORE_LEASE_ANNOTATION}' in oldObject.metadata.annotations) || (oldObject.spec.replicas == 0 && object.spec.replicas == 0)`,
          message:
            "Acquire a world restoration lease only after stopping the server",
          reason: "Forbidden",
        },
      ],
    },
  });
  new ApiObject(chart, "minecraft-tsmc-restoration-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name: policyName,
      annotations: { "argocd.argoproj.io/sync-wave": "-29" },
    },
    spec: { policyName, validationActions: ["Deny"] },
  });

  // Scale requests have no StatefulSet annotations or pod template. Read the
  // current parent as a parameter so mc-router cannot bypass the stopped lease.
  const scalePolicyName = "minecraft-tsmc-world-restoration-scale.sjer.red";
  const parentAnnotations = "params.metadata.annotations";
  const parentLeased = `has(${parentAnnotations}) && '${RESTORE_LEASE_ANNOTATION}' in ${parentAnnotations}`;
  new ApiObject(chart, "minecraft-tsmc-restoration-scale-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name: scalePolicyName,
      annotations: { "argocd.argoproj.io/sync-wave": "-30" },
    },
    spec: {
      ...minecraftMaintenanceMatch("statefulsets/scale"),
      paramKind: { apiVersion: "apps/v1", kind: "StatefulSet" },
      validations: [
        {
          expression: `!(${parentLeased}) || object.spec.replicas == 0 || ('${RESTORE_PHASE_ANNOTATION}' in ${parentAnnotations} && ${parentAnnotations}['${RESTORE_PHASE_ANNOTATION}'] == 'VALIDATING' && '${RESTORE_IMAGE_ANNOTATION}' in ${parentAnnotations} && object.spec.replicas == 1 && params.spec.template.spec.containers.size() == 1 && params.spec.template.spec.containers[0].image == ${parentAnnotations}['${RESTORE_IMAGE_ANNOTATION}'])`,
          message:
            "World restoration blocks scale requests except for its pinned private acceptance image",
          reason: "Forbidden",
        },
        {
          expression: `!(${parentLeased}) || !('sjer.red/mining-reset-lock' in ${parentAnnotations})`,
          message:
            "World restoration and mining reset leases are mutually exclusive",
          reason: "Forbidden",
        },
      ],
    },
  });
  new ApiObject(chart, "minecraft-tsmc-restoration-scale-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name: scalePolicyName,
      annotations: { "argocd.argoproj.io/sync-wave": "-29" },
    },
    spec: {
      policyName: scalePolicyName,
      validationActions: ["Deny"],
      paramRef: {
        name: "minecraft-tsmc",
        namespace: "minecraft-tsmc",
        parameterNotFoundAction: "Deny",
      },
    },
  });

  // DELETE has no object. Preserve the parent lease from oldObject so an
  // Argo replacement cannot create an unleased server against an owned PVC.
  const deletePolicyName = "minecraft-tsmc-world-restoration-delete.sjer.red";
  new ApiObject(chart, "minecraft-tsmc-restoration-delete-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name: deletePolicyName,
      annotations: { "argocd.argoproj.io/sync-wave": "-30" },
    },
    spec: {
      ...minecraftMaintenanceMatch("statefulsets", "DELETE"),
      validations: [
        {
          expression: `!(${priorLeased})`,
          message:
            "Release the restoration lease before deleting its StatefulSet",
          reason: "Forbidden",
        },
      ],
    },
  });
  new ApiObject(chart, "minecraft-tsmc-restoration-delete-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name: deletePolicyName,
      annotations: { "argocd.argoproj.io/sync-wave": "-29" },
    },
    spec: { policyName: deletePolicyName, validationActions: ["Deny"] },
  });

  // Services are the private admission barrier. A replacement must not expose
  // the validating pod by restoring the chart's ordinary selectors.
  const servicePriorLeased = `oldObject != null && (${priorLeased})`;
  const closed = `has(object.spec.selector) && '${RESTORE_ACCESS_SELECTOR}' in object.spec.selector && object.spec.selector['${RESTORE_ACCESS_SELECTOR}'] == 'closed' && object.spec.type == (request.name == 'minecraft-tsmc-bedrock' ? 'NodePort' : 'ClusterIP')`;
  for (const operation of ["write", "delete"] as const) {
    const servicePolicyName = `minecraft-tsmc-world-restoration-service-${operation}.sjer.red`;
    const validations =
      operation === "write"
        ? [
            {
              expression: `!(${parentLeased}) || ((${leased}) && ${annotations}['${RESTORE_LEASE_ANNOTATION}'] == ${parentAnnotations}['${RESTORE_LEASE_ANNOTATION}'] && (${closed}))`,
              message:
                "Keep restoration Services closed under the parent lease owner",
              reason: "Forbidden",
            },
            {
              expression: `!(${servicePriorLeased}) || ((${leased}) && ${annotations}['${RESTORE_LEASE_ANNOTATION}'] == ${priorAnnotations}['${RESTORE_LEASE_ANNOTATION}'] && (${closed})) || (!(${parentLeased}) && params.spec.replicas == 0 && !(${leased}))`,
              message:
                "Release a restoration Service only after stopping and releasing its parent",
              reason: "Forbidden",
            },
          ]
        : [
            {
              expression: `!(${parentLeased}) && (!(${priorLeased}) || params.spec.replicas == 0)`,
              message:
                "Release the restoration lease before deleting its Service",
              reason: "Forbidden",
            },
          ];
    new ApiObject(
      chart,
      `minecraft-tsmc-restoration-service-${operation}-policy`,
      {
        apiVersion: "admissionregistration.k8s.io/v1",
        kind: "ValidatingAdmissionPolicy",
        metadata: {
          name: servicePolicyName,
          annotations: { "argocd.argoproj.io/sync-wave": "-30" },
        },
        spec: {
          failurePolicy: "Fail",
          paramKind: { apiVersion: "apps/v1", kind: "StatefulSet" },
          matchConstraints: {
            matchPolicy: "Equivalent",
            resourceRules: [
              {
                apiGroups: [""],
                apiVersions: ["v1"],
                operations:
                  operation === "write" ? ["CREATE", "UPDATE"] : ["DELETE"],
                resources: ["services"],
                scope: "Namespaced",
              },
            ],
          },
          matchConditions: [
            {
              name: "the-storm-routes",
              expression:
                "request.namespace == 'minecraft-tsmc' && request.name in ['minecraft-tsmc', 'minecraft-tsmc-bedrock', 'minecraft-tsmc-bluemap', 'minecraft-tsmc-rcon']",
            },
          ],
          validations,
        },
      },
    );
    new ApiObject(
      chart,
      `minecraft-tsmc-restoration-service-${operation}-binding`,
      {
        apiVersion: "admissionregistration.k8s.io/v1",
        kind: "ValidatingAdmissionPolicyBinding",
        metadata: {
          name: servicePolicyName,
          annotations: { "argocd.argoproj.io/sync-wave": "-29" },
        },
        spec: {
          policyName: servicePolicyName,
          validationActions: ["Deny"],
          paramRef: {
            name: "minecraft-tsmc",
            namespace: "minecraft-tsmc",
            // Bootstrap creates Services before the parent. Once leased, the
            // parent deletion guard guarantees this parameter cannot disappear.
            parameterNotFoundAction: "Allow",
          },
        },
      },
    );
  }
}
