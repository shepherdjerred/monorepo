import { ApiObject, type Chart } from "cdk8s";
import { RAM_SCRATCH } from "@shepherdjerred/woodpecker-config-extension/src/pipeline/ram-scratch.ts";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_SYNC_WAVES,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

const marked = `has(object.metadata.labels) && '${RAM_SCRATCH.label}' in object.metadata.labels`;
const eligible = `${marked} && object.metadata.labels['${RAM_SCRATCH.label}'] == '${RAM_SCRATCH.profile}' && 'ci.sjer.red/step-key' in object.metadata.labels && object.metadata.labels['ci.sjer.red/step-key'] == 'verify' && has(object.metadata.annotations) && 'ci.sjer.red/event' in object.metadata.annotations && object.metadata.annotations['ci.sjer.red/event'] == 'manual' && 'ci.sjer.red/branch' in object.metadata.annotations && object.metadata.annotations['ci.sjer.red/branch'].startsWith('ci-canary/') && object.spec.containers.size() == 1`;
const metadata = (name: string, wave: string) => ({
  name,
  annotations: { [ARGOCD_SYNC_WAVE_ANNOTATION]: wave },
});

/** Fixed tmpfs mounts on the execution pod; checkout and reports stay on PVC. */
export function createRamScratchPolicy(chart: Chart): void {
  const matchConstraints = {
    namespaceSelector: {
      matchLabels: { "kubernetes.io/metadata.name": WOODPECKER_CI_NAMESPACE },
    },
    resourceRules: [
      {
        apiGroups: [""],
        apiVersions: ["v1"],
        operations: ["CREATE"],
        resources: ["pods"],
      },
    ],
  };
  const mutationName = "woodpecker-ram-scratch.sjer.red";
  const mounts = RAM_SCRATCH.volumes
    .map(
      (volume) =>
        `Object.spec.containers.volumeMounts{name: '${volume.name}', mountPath: '${volume.path}'}`,
    )
    .join(", ");
  const volumes = RAM_SCRATCH.volumes
    .map(
      (volume) =>
        `Object.spec.volumes{name: '${volume.name}', emptyDir: Object.spec.volumes.emptyDir{medium: 'Memory', sizeLimit: '${volume.size}'}}`,
    )
    .join(", ");
  new ApiObject(chart, "ram-scratch-mutation", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicy",
    metadata: metadata(mutationName, APPLICATION_SYNC_WAVES.admissionPolicy),
    spec: {
      failurePolicy: "Fail",
      reinvocationPolicy: "IfNeeded",
      matchConstraints,
      matchConditions: [{ name: "verify-canary", expression: eligible }],
      mutations: [
        {
          patchType: "ApplyConfiguration",
          applyConfiguration: {
            expression: `Object{spec: Object.spec{volumes: [${volumes}], containers: object.spec.containers.map(c, Object.spec.containers{name: c.name, volumeMounts: [${mounts}]})}}`,
          },
        },
      ],
    },
  });
  new ApiObject(chart, "ram-scratch-mutation-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicyBinding",
    metadata: metadata(mutationName, APPLICATION_SYNC_WAVES.admissionBinding),
    spec: { policyName: mutationName },
  });
  const guardName = "woodpecker-ram-scratch-guard.sjer.red";
  new ApiObject(chart, "ram-scratch-guard", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: metadata(guardName, APPLICATION_SYNC_WAVES.admissionPolicy),
    spec: {
      failurePolicy: "Fail",
      matchConstraints,
      matchConditions: [{ name: "scratch-requested", expression: marked }],
      validations: [
        {
          expression: eligible,
          message:
            "RAM scratch is restricted to a single verify container on a manual canary branch",
          reason: "Forbidden",
        },
        {
          expression: `object.spec.containers.all(c, has(c.resources) && has(c.resources.requests) && 'memory' in c.resources.requests && has(c.resources.limits) && 'memory' in c.resources.limits && quantity(c.resources.requests['memory']).compareTo(quantity('${RAM_SCRATCH.resources.memoryRequest}')) >= 0 && quantity(c.resources.limits['memory']).compareTo(quantity('${RAM_SCRATCH.resources.memoryLimit}')) >= 0)`,
          message:
            "RAM scratch requires its full memory allowance in requests and limits",
          reason: "Forbidden",
        },
        ...RAM_SCRATCH.volumes.map((volume) => ({
          expression: `has(object.spec.volumes) && object.spec.volumes.exists(v, v.name == '${volume.name}' && has(v.emptyDir) && has(v.emptyDir.medium) && v.emptyDir.medium == 'Memory' && has(v.emptyDir.sizeLimit) && quantity(v.emptyDir.sizeLimit).compareTo(quantity('${volume.size}')) == 0) && object.spec.containers.all(c, has(c.volumeMounts) && c.volumeMounts.exists(m, m.name == '${volume.name}' && m.mountPath == '${volume.path}' && !has(m.subPath) && !has(m.subPathExpr) && (!has(m.readOnly) || !m.readOnly))) && (!has(object.spec.initContainers) || object.spec.initContainers.all(c, !has(c.volumeMounts) || !c.volumeMounts.exists(m, m.name == '${volume.name}')))`,
          message: `RAM scratch requires the bounded ${volume.name} execution mount`,
          reason: "Forbidden",
        })),
      ],
    },
  });
  new ApiObject(chart, "ram-scratch-guard-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: metadata(guardName, APPLICATION_SYNC_WAVES.admissionBinding),
    spec: { policyName: guardName, validationActions: ["Deny"] },
  });
}
