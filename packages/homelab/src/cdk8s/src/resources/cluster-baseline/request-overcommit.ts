import { ApiObject, type Chart } from "cdk8s";
import {
  ARGOCD_SYNC_WAVE_ANNOTATION,
  APPLICATION_SYNC_WAVES,
} from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { CI_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import {
  BURST_SERVICE_PRIORITY,
  INFRASTRUCTURE_PRIORITY,
} from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { KUEUE_MANAGED_NAMESPACE_LABEL } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/ci-namespace.ts";

export const REQUEST_OVERCOMMIT_POLICY = "torvalds-request-overcommit.sjer.red";
export const REQUEST_OVERCOMMIT_ANNOTATION =
  "resources.sjer.red/request-overcommit";

/**
 * Scheduling-only overcommit for production pods. Declared requests describe
 * each workload's own p95, but those peaks rarely coincide: over 14 days
 * (2026-11-08) torvalds pods requested 22.5 of 27 allocatable cores while the
 * whole node's pod CPU averaged 3.1 cores (p95 4.7, max 9.2), and requested
 * 84 of 95 Gi memory against a 76 Gi peak working set (67 Gi RSS). Scaling
 * requests at Pod admission lets the scheduler reach that capacity while
 * limits, priority classes and kubelet eviction keep their declared bounds.
 *
 * CPU is compressible, so it takes the larger factor. Memory is not: its
 * factor is small, and burst and infrastructure pods keep their memory
 * request because a fixed JVM heap or control-plane footprint is real usage.
 */
export const CPU_REQUEST_FACTOR = 0.5;
export const MEMORY_REQUEST_FACTOR = 0.9;
const MEMORY_PRESERVED_PRIORITIES = [
  BURST_SERVICE_PRIORITY,
  INFRASTRUCTURE_PRIORITY,
] as const;

const celDouble = (value: number) => {
  if (!(value > 0 && value <= 1)) {
    throw new Error(`request factor must be in (0, 1], got ${String(value)}`);
  }
  return value.toFixed(3);
};
/** CEL has no quantity multiply or guaranteed math.ceil; round up by hand. */
const ceil = (expression: string) =>
  `(int(${expression}) + (double(int(${expression})) < ${expression} ? 1 : 0))`;
const scaledCpu = (request: string) =>
  `string(${ceil(`quantity(${request}).asApproximateFloat() * 1000.0 * ${celDouble(CPU_REQUEST_FACTOR)}`)}) + 'm'`;
const scaledMemory = (request: string) =>
  `string(${ceil(`quantity(${request}).asApproximateFloat() * ${celDouble(MEMORY_REQUEST_FACTOR)}`)})`;

const annotationAbsent = (key: string) =>
  `!has(object.metadata.annotations) || !('${key}' in object.metadata.annotations)`;
const targetsCiNode = [
  `(has(object.spec.nodeSelector) && object.spec.nodeSelector.exists(k, object.spec.nodeSelector[k] == '${CI_NODE_HOSTNAME}'))`,
  `(has(object.spec.affinity) && has(object.spec.affinity.nodeAffinity) && has(object.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution) && object.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms.exists(t, (has(t.matchExpressions) && t.matchExpressions.exists(e, has(e.values) && '${CI_NODE_HOSTNAME}' in e.values)) || (has(t.matchFields) && t.matchFields.exists(e, has(e.values) && '${CI_NODE_HOSTNAME}' in e.values))))`,
].join(" || ");
/** A pod is Guaranteed only when every container's requests equal its limits. */
const notGuaranteed = `object.spec.containers.exists(c, !has(c.resources) || !has(c.resources.limits) || !has(c.resources.requests) || !('cpu' in c.resources.limits) || !('memory' in c.resources.limits) || !('cpu' in c.resources.requests) || !('memory' in c.resources.requests) || quantity(c.resources.requests['cpu']).compareTo(quantity(c.resources.limits['cpu'])) != 0 || quantity(c.resources.requests['memory']).compareTo(quantity(c.resources.limits['memory'])) != 0)`;

type ContainerField = "containers" | "initContainers";
const hasRequests = "has(c.resources) && has(c.resources.requests)";
const hasCpu = `${hasRequests} && 'cpu' in c.resources.requests`;
const hasMemory = `variables.scaleMemory && ${hasRequests} && 'memory' in c.resources.requests`;
/**
 * Only existing requests change, so BestEffort containers stay BestEffort and
 * limits are untouched. Merging by container name leaves other keys in place.
 */
const scaledContainers = (field: ContainerField) => {
  const cpu = scaledCpu("c.resources.requests['cpu']");
  const memory = scaledMemory("c.resources.requests['memory']");
  const requests = `(${hasCpu}) && (${hasMemory}) ? {'cpu': ${cpu}, 'memory': ${memory}} : ((${hasCpu}) ? {'cpu': ${cpu}} : {'memory': ${memory}})`;
  return `object.spec.${field}.filter(c, (${hasCpu}) || (${hasMemory})).map(c, Object.spec.${field}{name: c.name, resources: Object.spec.${field}.resources{requests: ${requests}}})`;
};

const metadata = (wave: string) => ({
  name: REQUEST_OVERCOMMIT_POLICY,
  annotations: { [ARGOCD_SYNC_WAVE_ANNOTATION]: wave },
});

/**
 * Scales production Pod requests on CREATE. The CI node, Kueue-managed
 * namespaces (whose quotas count real requests), kube-system, mirror pods,
 * Guaranteed pods and pod-level resources are excluded.
 *
 * Failure is ignored deliberately: this is a capacity optimization, not a
 * guard, and a fault must never block production pod creation. A pod that
 * misses the mutation keeps its declared requests.
 */
export function createRequestOvercommitPolicy(chart: Chart): void {
  const marker = `cpu=${String(CPU_REQUEST_FACTOR)},memory=${String(MEMORY_REQUEST_FACTOR)}`;
  new ApiObject(chart, "request-overcommit-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicy",
    metadata: metadata(APPLICATION_SYNC_WAVES.admissionPolicy),
    spec: {
      failurePolicy: "Ignore",
      reinvocationPolicy: "Never",
      matchConstraints: {
        namespaceSelector: {
          matchExpressions: [
            {
              key: "kubernetes.io/metadata.name",
              operator: "NotIn",
              values: ["kube-system"],
            },
            { key: KUEUE_MANAGED_NAMESPACE_LABEL, operator: "DoesNotExist" },
          ],
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
      matchConditions: [
        {
          name: "not-mirror-pod",
          expression: annotationAbsent("kubernetes.io/config.mirror"),
        },
        {
          name: "not-already-scaled",
          expression: annotationAbsent(REQUEST_OVERCOMMIT_ANNOTATION),
        },
        { name: "not-ci-node", expression: `!(${targetsCiNode})` },
        { name: "not-guaranteed", expression: notGuaranteed },
        {
          name: "no-pod-level-resources",
          expression: "!has(object.spec.resources)",
        },
      ],
      variables: [
        {
          name: "scaleMemory",
          expression: `!has(object.spec.priorityClassName) || !(object.spec.priorityClassName in [${MEMORY_PRESERVED_PRIORITIES.map((priority) => `'${priority}'`).join(", ")}])`,
        },
      ],
      mutations: [
        {
          patchType: "ApplyConfiguration",
          applyConfiguration: {
            expression: `Object{metadata: Object.metadata{annotations: {'${REQUEST_OVERCOMMIT_ANNOTATION}': variables.scaleMemory ? '${marker}' : 'cpu=${String(CPU_REQUEST_FACTOR)}'}}, spec: Object.spec{containers: ${scaledContainers("containers")}, initContainers: has(object.spec.initContainers) ? ${scaledContainers("initContainers")} : []}}`,
          },
        },
      ],
    },
  });
  new ApiObject(chart, "request-overcommit-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "MutatingAdmissionPolicyBinding",
    metadata: metadata(APPLICATION_SYNC_WAVES.admissionBinding),
    spec: { policyName: REQUEST_OVERCOMMIT_POLICY },
  });
}
