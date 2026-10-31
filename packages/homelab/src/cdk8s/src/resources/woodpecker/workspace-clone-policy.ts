import { ApiObject, type Chart } from "cdk8s";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_SYNC_WAVES,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import {
  CI_WORKSPACE_STORAGE_CLASS,
  CI_WORKSPACE_VOLUME_SIZE,
} from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

/**
 * Names the current golden snapshot in key `snapshot`. Temporal's
 * `publishCiWorkspaceGoldenSnapshot` owns it, not ArgoCD: it changes with
 * every refresh. Absent or empty, workspaces start empty as before, so
 * clearing it is the rollback. Must match packages/temporal's
 * ci-workspace-golden.ts.
 */
export const CI_WORKSPACE_GOLDEN_CONFIG_MAP = "ci-workspace-golden";
/** Every golden VolumeSnapshot's name starts with this. */
export const CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX = "ci-workspace-golden-";

const SNAPSHOT_GROUP = "snapshot.storage.k8s.io";
const MUTATION = "woodpecker-workspace-clone.sjer.red";
const GUARD = "woodpecker-workspace-clone-guard.sjer.red";

const claimRules = {
  namespaceSelector: {
    matchLabels: { "kubernetes.io/metadata.name": WOODPECKER_CI_NAMESPACE },
  },
  resourceRules: [
    {
      apiGroups: [""],
      apiVersions: ["v1"],
      operations: ["CREATE"],
      resources: ["persistentvolumeclaims"],
    },
  ],
};
const workspaceClaim = `has(object.spec.storageClassName) && object.spec.storageClassName == '${CI_WORKSPACE_STORAGE_CLASS}'`;
const sized = `has(object.spec.resources) && has(object.spec.resources.requests) && 'storage' in object.spec.resources.requests && quantity(object.spec.resources.requests['storage']).compareTo(quantity('${CI_WORKSPACE_VOLUME_SIZE}')) == 0`;
const sourced = "has(object.spec.dataSource) || has(object.spec.dataSourceRef)";
const golden = `has(params.data) && 'snapshot' in params.data && params.data['snapshot'].startsWith('${CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX}')`;
type SourceField = "dataSource" | "dataSourceRef";
// dataSource and dataSourceRef are atomic structs, which an ApplyConfiguration
// may not set; a JSON patch adds them whole.
const reference = (field: SourceField) =>
  `JSONPatch{op: 'add', path: '/spec/${field}', value: Object.spec.${field}{apiGroup: '${SNAPSHOT_GROUP}', kind: 'VolumeSnapshot', name: params.data['snapshot']}}`;
const goldenSource = (field: SourceField) =>
  `!has(object.spec.${field}) || (has(object.spec.${field}.apiGroup) && object.spec.${field}.apiGroup == '${SNAPSHOT_GROUP}' && object.spec.${field}.kind == 'VolumeSnapshot' && object.spec.${field}.name.startsWith('${CI_WORKSPACE_GOLDEN_SNAPSHOT_PREFIX}'))`;
const metadata = (name: string, wave: string) => ({
  name,
  annotations: { [ARGOCD_SYNC_WAVE_ANNOTATION]: wave },
});

/**
 * Woodpecker creates each workflow's workspace claim and exposes no way to
 * give it a data source, so admission adds one: the current golden snapshot.
 * The ZFS driver then creates the workspace as a clone, in constant time and
 * without writing the checkout and dependencies again. Gate claims (1G) never
 * match, since a clone must equal its snapshot's size.
 *
 * The guard keeps any other source off workspace claims: a workspace may only
 * start from a golden snapshot of the workspace size.
 */
export function createWorkspaceClonePolicy(chart: Chart): void {
  new ApiObject(chart, "workspace-clone-mutation", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicy",
    metadata: metadata(MUTATION, APPLICATION_SYNC_WAVES.admissionPolicy),
    spec: {
      failurePolicy: "Fail",
      reinvocationPolicy: "Never",
      paramKind: { apiVersion: "v1", kind: "ConfigMap" },
      matchConstraints: claimRules,
      matchConditions: [
        { name: "workspace-claim", expression: workspaceClaim },
        { name: "workspace-size", expression: sized },
        { name: "no-source", expression: `!(${sourced})` },
      ],
      mutations: [
        {
          patchType: "JSONPatch",
          jsonPatch: {
            expression: `${golden} ? [${reference("dataSource")}, ${reference("dataSourceRef")}] : []`,
          },
        },
      ],
    },
  });
  new ApiObject(chart, "workspace-clone-mutation-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicyBinding",
    metadata: metadata(MUTATION, APPLICATION_SYNC_WAVES.admissionBinding),
    spec: {
      policyName: MUTATION,
      paramRef: {
        name: CI_WORKSPACE_GOLDEN_CONFIG_MAP,
        namespace: WOODPECKER_CI_NAMESPACE,
        parameterNotFoundAction: "Allow",
      },
    },
  });

  new ApiObject(chart, "workspace-clone-guard", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: metadata(GUARD, APPLICATION_SYNC_WAVES.admissionPolicy),
    spec: {
      failurePolicy: "Fail",
      matchConstraints: claimRules,
      matchConditions: [
        { name: "workspace-claim", expression: workspaceClaim },
        { name: "sourced", expression: sourced },
      ],
      validations: [
        {
          expression: `${goldenSource("dataSource")} && ${goldenSource("dataSourceRef")}`,
          message:
            "A CI workspace claim may only be cloned from a golden workspace snapshot",
          reason: "Forbidden",
        },
        {
          expression: sized,
          message: `A cloned CI workspace claim must request exactly ${CI_WORKSPACE_VOLUME_SIZE}`,
          reason: "Forbidden",
        },
      ],
    },
  });
  new ApiObject(chart, "workspace-clone-guard-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: metadata(GUARD, APPLICATION_SYNC_WAVES.admissionBinding),
    spec: { policyName: GUARD, validationActions: ["Deny"] },
  });
}
