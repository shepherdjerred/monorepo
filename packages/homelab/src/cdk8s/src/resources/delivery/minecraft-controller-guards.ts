import { ApiObject, type Chart } from "cdk8s";
import { createMinecraftControllerPodGuards } from "./minecraft-controller-pod-guards.ts";

const ACTOR =
  "system:serviceaccount:delivery-tsmc-controller:delivery-tsmc-controller";
const LEASE = "sjer.red/world-restore-lease";
const PHASE = "sjer.red/world-restore-phase";
const IMAGE = "sjer.red/world-restore-image";
const ACCESS = "sjer.red/world-restore-access";

type Guard = {
  group: string;
  version: string;
  resources: string[];
  operations: string[];
  expressions: string[];
  variables?: { name: string; expression: string }[];
};

export function controllerGuard(chart: Chart, id: string, guard: Guard): void {
  const name = `delivery-tsmc-${id}.sjer.red`;
  new ApiObject(chart, `${name}-policy`, {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name,
      namespace: "",
      annotations: { "argocd.argoproj.io/sync-wave": "-30" },
    },
    spec: {
      failurePolicy: "Fail",
      matchConstraints: {
        matchPolicy: "Equivalent",
        resourceRules: [
          {
            apiGroups: [guard.group],
            apiVersions: [guard.version],
            resources: guard.resources,
            operations: guard.operations,
            scope: "Namespaced",
          },
        ],
      },
      matchConditions: [
        {
          name: "controller-identity",
          expression: `request.userInfo.username == '${ACTOR}'`,
        },
      ],
      ...(guard.variables === undefined ? {} : { variables: guard.variables }),
      validations: guard.expressions.map((expression, index) => ({
        expression,
        message: `Delivery Storm controller capability ${id}/${String(index)} rejected this operation`,
        reason: "Forbidden",
      })),
    },
  });
  new ApiObject(chart, `${name}-binding`, {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name,
      namespace: "",
      annotations: { "argocd.argoproj.io/sync-wave": "-29" },
    },
    spec: { policyName: name, validationActions: ["Deny"] },
  });
}

function unchanged(path: string): string {
  return `(has(object.${path}) == has(oldObject.${path}) && (!has(object.${path}) || object.${path} == oldObject.${path}))`;
}

function preservedMap(
  current: string,
  prior: string,
  allowed: string[],
): string {
  const keys = JSON.stringify(allowed);
  return `${current}.all(k, k in ${keys} || (k in ${prior} && ${current}[k] == ${prior}[k])) && ${prior}.all(k, k in ${keys} || (k in ${current} && ${current}[k] == ${prior}[k]))`;
}

const annotations = [
  {
    name: "annotations",
    expression:
      "has(object.metadata.annotations) ? object.metadata.annotations : {}",
  },
  {
    name: "priorAnnotations",
    expression:
      "has(oldObject.metadata.annotations) ? oldObject.metadata.annotations : {}",
  },
];

/** These grants never authorize a routine image/template replacement or a production-volume writer. */
export function createMinecraftControllerGuards(chart: Chart): void {
  controllerGuard(chart, "server", {
    group: "apps",
    version: "v1",
    resources: ["statefulsets"],
    operations: ["UPDATE"],
    variables: annotations,
    expressions: [
      "request.dryRun || (request.namespace == 'minecraft-tsmc' && request.name == 'minecraft-tsmc' && object.spec.replicas in [0, 1])",
      `request.dryRun || (${["serviceName", "selector", "template", "volumeClaimTemplates", "podManagementPolicy", "updateStrategy", "revisionHistoryLimit", "minReadySeconds", "persistentVolumeClaimRetentionPolicy", "ordinals"].map((key) => unchanged(`spec.${key}`)).join(" && ")})`,
      `request.dryRun || (${unchanged("metadata.labels")} && ${unchanged("metadata.finalizers")} && ${unchanged("metadata.ownerReferences")} && ${preservedMap("variables.annotations", "variables.priorAnnotations", [LEASE, PHASE, IMAGE])})`,
      `request.dryRun || (!('${PHASE}' in variables.annotations) || variables.annotations['${PHASE}'] == 'OFFLINE')`,
    ],
  });
  controllerGuard(chart, "routes", {
    group: "",
    version: "v1",
    resources: ["services"],
    operations: ["UPDATE"],
    variables: [
      ...annotations,
      {
        name: "selectors",
        expression: "has(object.spec.selector) ? object.spec.selector : {}",
      },
      {
        name: "priorSelectors",
        expression:
          "has(oldObject.spec.selector) ? oldObject.spec.selector : {}",
      },
    ],
    expressions: [
      "request.dryRun || (request.namespace == 'minecraft-tsmc' && request.name in ['minecraft-tsmc', 'minecraft-tsmc-bedrock', 'minecraft-tsmc-bluemap', 'minecraft-tsmc-rcon'])",
      `request.dryRun || (${["ports", "clusterIP", "clusterIPs", "type", "externalIPs", "sessionAffinity", "loadBalancerIP", "loadBalancerSourceRanges", "externalName", "externalTrafficPolicy", "healthCheckNodePort", "publishNotReadyAddresses", "sessionAffinityConfig", "ipFamilies", "ipFamilyPolicy", "allocateLoadBalancerNodePorts", "loadBalancerClass", "internalTrafficPolicy", "trafficDistribution"].map((key) => unchanged(`spec.${key}`)).join(" && ")})`,
      `request.dryRun || (${unchanged("metadata.labels")} && ${unchanged("metadata.finalizers")} && ${unchanged("metadata.ownerReferences")} && ${preservedMap("variables.annotations", "variables.priorAnnotations", [LEASE, "mc-router.itzg.me/autoScaleUp"])} && ${preservedMap("variables.selectors", "variables.priorSelectors", [ACCESS])})`,
    ],
  });
  controllerGuard(chart, "destructive-probes", {
    group: "apps",
    version: "v1",
    resources: ["statefulsets", "statefulsets/scale"],
    operations: ["UPDATE", "DELETE"],
    expressions: [
      "((!has(request.subResource) || request.subResource != 'scale') && request.operation != 'DELETE') || request.dryRun",
    ],
  });
  controllerGuard(chart, "route-delete-probes", {
    group: "",
    version: "v1",
    resources: ["services"],
    operations: ["DELETE"],
    expressions: ["request.dryRun"],
  });
  controllerGuard(chart, "backup", {
    group: "velero.io",
    version: "v1",
    resources: ["backups"],
    operations: ["CREATE"],
    expressions: [
      `request.namespace == 'velero' && object.metadata.name == 'storm-world-' + object.metadata.labels['${LEASE}']`,
      "object.spec.includedNamespaces == ['minecraft-tsmc'] && object.spec.includedResources == ['persistentvolumeclaims', 'persistentvolumes']",
      "object.spec.labelSelector.matchLabels == {'velero.io/backup': 'enabled'} && !has(object.spec.labelSelector.matchExpressions)",
      "object.spec.snapshotVolumes == true && object.spec.storageLocation == 'default' && object.spec.volumeSnapshotLocations == ['zfspv-incr'] && object.spec.ttl == '720h'",
      "!has(object.spec.hooks) || !has(object.spec.hooks.resources) || object.spec.hooks.resources.size() == 0",
    ],
  });
  controllerGuard(chart, "restore", {
    group: "velero.io",
    version: "v1",
    resources: ["restores"],
    operations: ["CREATE"],
    expressions: [
      `request.namespace == 'velero' && object.metadata.name == 'storm-verify-' + object.metadata.labels['${LEASE}'] && object.spec.backupName == 'storm-world-' + object.metadata.labels['${LEASE}']`,
      "object.spec.includedNamespaces == ['minecraft-tsmc'] && object.spec.includedResources == ['persistentvolumeclaims', 'persistentvolumes'] && object.spec.namespaceMapping == {'minecraft-tsmc': 'minecraft-tsmc-delivery-validation'} && object.spec.restorePVs == true",
      "!has(object.spec.resourceModifier) && (!has(object.spec.hooks) || !has(object.spec.hooks.resources) || object.spec.hooks.resources.size() == 0)",
    ],
  });
  controllerGuard(chart, "copy-delete", {
    group: "",
    version: "v1",
    resources: ["persistentvolumeclaims"],
    operations: ["DELETE"],
    expressions: [
      "request.namespace == 'minecraft-tsmc-delivery-validation' && request.name == 'datadir-minecraft-tsmc-0' && has(oldObject.metadata.labels) && 'velero.io/restore-name' in oldObject.metadata.labels && oldObject.metadata.labels['velero.io/restore-name'].startsWith('storm-verify-')",
      "has(request.options.preconditions) && request.options.preconditions.uid == oldObject.metadata.uid && request.options.preconditions.resourceVersion == oldObject.metadata.resourceVersion",
    ],
  });
  createMinecraftControllerPodGuards(chart);
}
