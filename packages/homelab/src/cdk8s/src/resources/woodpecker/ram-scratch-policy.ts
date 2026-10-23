import { ApiObject, type Chart } from "cdk8s";
import {
  RAM_SCRATCH_PROFILES,
  type RamScratchProfile,
} from "@shepherdjerred/woodpecker-config-extension/src/pipeline/ram-scratch.ts";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_SYNC_WAVES,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

const PROFILES: readonly RamScratchProfile[] =
  Object.values(RAM_SCRATCH_PROFILES);
const LABEL = RAM_SCRATCH_PROFILES.verify.label;
const marked = `has(object.metadata.labels) && '${LABEL}' in object.metadata.labels`;
/** The pod is one lane's single execution container carrying that lane's profile. */
const eligible = (profile: RamScratchProfile) =>
  `${marked} && object.metadata.labels['${LABEL}'] == '${profile.profile}' && 'ci.sjer.red/step-key' in object.metadata.labels && object.metadata.labels['ci.sjer.red/step-key'] == '${profile.stepKey}' && object.spec.containers.size() == 1`;
/**
 * Every requirement is checked under its own profile; a pod matching no
 * profile fails the first validation.
 */
const when = (profile: RamScratchProfile, expression: string) =>
  `object.metadata.labels['${LABEL}'] != '${profile.profile}' || (${expression})`;
const metadata = (name: string, wave: string) => ({
  name,
  annotations: { [ARGOCD_SYNC_WAVE_ANNOTATION]: wave },
});
const mutationName = (profile: RamScratchProfile) =>
  profile.stepKey === "verify"
    ? "woodpecker-ram-scratch.sjer.red"
    : `woodpecker-ram-scratch-${profile.stepKey}.sjer.red`;

/**
 * Fixed tmpfs mounts on a lane's execution pod; checkout and reports stay on
 * PVC. Any CI execution pod of a profiled lane may carry its profile: Kueue
 * admits the profile's full memory request, which bounds how many run at once.
 */
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
  for (const profile of PROFILES) {
    const name = mutationName(profile);
    const id = profile.stepKey === "verify" ? "" : `-${profile.stepKey}`;
    const mounts = profile.volumes
      .map(
        (volume) =>
          `Object.spec.containers.volumeMounts{name: '${volume.name}', mountPath: '${volume.path}'}`,
      )
      .join(", ");
    const volumes = profile.volumes
      .map(
        (volume) =>
          `Object.spec.volumes{name: '${volume.name}', emptyDir: Object.spec.volumes.emptyDir{medium: 'Memory', sizeLimit: '${volume.size}'}}`,
      )
      .join(", ");
    new ApiObject(chart, `ram-scratch-mutation${id}`, {
      apiVersion: "admissionregistration.k8s.io/v1",
      kind: "MutatingAdmissionPolicy",
      metadata: metadata(name, APPLICATION_SYNC_WAVES.admissionPolicy),
      spec: {
        failurePolicy: "Fail",
        reinvocationPolicy: "IfNeeded",
        matchConstraints,
        matchConditions: [
          { name: `${profile.stepKey}-scratch`, expression: eligible(profile) },
        ],
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
    new ApiObject(chart, `ram-scratch-mutation-binding${id}`, {
      apiVersion: "admissionregistration.k8s.io/v1",
      kind: "MutatingAdmissionPolicyBinding",
      metadata: metadata(name, APPLICATION_SYNC_WAVES.admissionBinding),
      spec: { policyName: name },
    });
  }
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
          expression: PROFILES.map((profile) => `(${eligible(profile)})`).join(
            " || ",
          ),
          message:
            "RAM scratch is restricted to the single execution container of its profiled lane",
          reason: "Forbidden",
        },
        ...PROFILES.map((profile) => ({
          expression: when(
            profile,
            `object.spec.containers.all(c, has(c.resources) && has(c.resources.requests) && 'memory' in c.resources.requests && has(c.resources.limits) && 'memory' in c.resources.limits && quantity(c.resources.requests['memory']).compareTo(quantity('${profile.resources.memoryRequest}')) >= 0 && quantity(c.resources.limits['memory']).compareTo(quantity('${profile.resources.memoryLimit}')) >= 0)`,
          ),
          message: `RAM scratch ${profile.profile} requires its full memory allowance in requests and limits`,
          reason: "Forbidden",
        })),
        ...PROFILES.flatMap((profile) =>
          profile.volumes.map((volume) => ({
            expression: when(
              profile,
              `has(object.spec.volumes) && object.spec.volumes.exists(v, v.name == '${volume.name}' && has(v.emptyDir) && has(v.emptyDir.medium) && v.emptyDir.medium == 'Memory' && has(v.emptyDir.sizeLimit) && quantity(v.emptyDir.sizeLimit).compareTo(quantity('${volume.size}')) == 0) && object.spec.containers.all(c, has(c.volumeMounts) && c.volumeMounts.exists(m, m.name == '${volume.name}' && m.mountPath == '${volume.path}' && !has(m.subPath) && !has(m.subPathExpr) && (!has(m.readOnly) || !m.readOnly))) && (!has(object.spec.initContainers) || object.spec.initContainers.all(c, !has(c.volumeMounts) || !c.volumeMounts.exists(m, m.name == '${volume.name}')))`,
            ),
            message: `RAM scratch ${profile.profile} requires the bounded ${volume.name} execution mount`,
            reason: "Forbidden",
          })),
        ),
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
