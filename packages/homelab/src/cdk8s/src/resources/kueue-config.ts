import type { Chart } from "cdk8s";
import { DELIVERY_STAGE_REQUESTS } from "homelab/src/delivery-stage-admission.ts";
import {
  ClusterQueueV1Beta2,
  ClusterQueueV1Beta2SpecPreemptionReclaimWithinCohort,
  ClusterQueueV1Beta2SpecPreemptionWithinClusterQueue,
  ClusterQueueV1Beta2SpecResourceGroupsFlavorsResourcesNominalQuota as NominalQuota,
  LocalQueueV1Beta2,
  ResourceFlavorV1Beta2,
  WorkloadPriorityClassV1Beta2,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/kueue.x-k8s.io.ts";
import {
  CI_ADMISSION_BUDGET,
  CI_COMPUTE_WORKFLOWS,
  CI_GATE_WORKFLOWS,
} from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

/** The CI ClusterQueue. Its name is what the queue alerts and dashboards select. */
export const CI_CLUSTER_QUEUE = "woodpecker";

/**
 * The CI LocalQueue. Named `default` deliberately: Kueue gives every pod in a
 * managed namespace that names no queue the LocalQueue called `default`, which
 * is how Woodpecker's clone, service, and step pods are queued without the
 * pipeline labelling any of them.
 */
export const CI_LOCAL_QUEUE = "default";
export const CI_GATE_CLUSTER_QUEUE = "woodpecker-gates";
export const CI_GATE_LOCAL_QUEUE = "ci-gates";

export const CI_MAINTENANCE_CLUSTER_QUEUE = "woodpecker-maintenance";
export const CI_MAINTENANCE_LOCAL_QUEUE = "ci-maintenance";

/**
 * Delivery's executor ClusterQueue, for stage Jobs in its two Job namespaces.
 *
 * Its quota is exactly one stage Job, reserved: it joins no cohort, so CI can
 * never borrow it and Delivery never holds CI quota. Sharing `woodpecker` gave
 * a waiting Job the highest priority (its pods' `batch-low` class outranks
 * every CI class) but no capacity. Without preemption, Kueue admits smaller
 * CI pods past a head that does not fit, so a Job needing 32Gi of scratch
 * waited until enough CI happened to finish at once. That quota also never
 * fitted two Jobs, so one reserved slot keeps Delivery's concurrency. The slot
 * sits beside the CI budget, and the CI compute memory quota in
 * `misc/ci-admission-budget.json` gives up the Job's 8Gi so every queue plus
 * buildkitd still fits liskov's allocatable memory.
 */
export const DELIVERY_CLUSTER_QUEUE = "delivery";
const DELIVERY_JOB_NAMESPACES = [
  "delivery-worker-jobs",
  "delivery-platform-jobs",
];

/**
 * Pods one workflow can have admitted at once.
 *
 * Woodpecker runs a workflow in stages: the clone pod, which finishes (and
 * releases its quota) first, then the services and the step together.
 */
export const CI_PODS_PER_WORKFLOW =
  1 + CI_ADMISSION_BUDGET.maxServicesPerWorkflow;

const COVERED_RESOURCES = ["cpu", "memory", "pods", "ephemeral-storage"];

const SYNC_WAVE = { "argocd.argoproj.io/sync-wave": "2" };

/** Kueue stops a plain pod by deleting it, which Woodpecker reads as success. */
const NEVER_PREEMPT = {
  withinClusterQueue: ClusterQueueV1Beta2SpecPreemptionWithinClusterQueue.NEVER,
  reclaimWithinCohort:
    ClusterQueueV1Beta2SpecPreemptionReclaimWithinCohort.NEVER,
};

/**
 * Resource admission for CI on liskov.
 *
 * The July 2026 freezes came from CI that a job count could not bound: nine
 * concurrent jobs were enough to lock up a node. So CI is admitted by the
 * resources it requests, against a budget that stays below the node's
 * allocatable capacity, and work that does not fit waits outside the
 * scheduler instead of piling onto the node.
 *
 * Woodpecker creates bare pods, so this runs on Kueue's pod integration: every
 * pod created in the CI namespace is held behind the `kueue.x-k8s.io/admission`
 * scheduling gate until its requests fit. A gated pod exists but is invisible
 * to the scheduler and the kubelet -- no scheduling churn, nothing to evict.
 * Pod integration can only be scoped by namespace, which is why the CI
 * namespace holds nothing that must be able to start while Kueue is down.
 *
 * Each pod is its own workload. A workflow's services are admitted before its
 * step, so admitted services must never be able to starve every step of
 * quota; `scripts/checks/ci/check-ci-admission-budget.ts` proves they cannot
 * against the generated pipeline. The `pods` quota is a backstop behind the
 * agent's workflow cap, counted in pods.
 *
 * Preemption stays off. Kueue stops a plain pod by deleting it, and
 * Woodpecker reads a pod that vanishes mid-step as a success.
 *
 * `ephemeral-storage` must stay covered: Kueue refuses a workload requesting a
 * resource its ClusterQueue does not cover, and every CI container requests
 * it. Leaving it out once froze CI completely.
 *
 * Quantities are written in the form the API server stores ("24", not
 * "24000m"): ArgoCD diffs the raw string, and a mismatch is a permanent
 * phantom OutOfSync that wedges the app-of-apps sync.
 */
export function createKueueConfig(chart: Chart) {
  new ResourceFlavorV1Beta2(chart, "kueue-resource-flavor", {
    metadata: { name: "default", annotations: SYNC_WAVE },
  });

  const quota = CI_ADMISSION_BUDGET.computeQuota;
  createClusterQueue(chart, "kueue-cluster-queue", CI_CLUSTER_QUEUE, {
    cpu: quota.cpu,
    memory: quota.memory,
    pods: String(CI_COMPUTE_WORKFLOWS * CI_PODS_PER_WORKFLOW),
    "ephemeral-storage": quota["ephemeral-storage"],
  });
  createLocalQueue(
    chart,
    "kueue-local-queue",
    CI_LOCAL_QUEUE,
    CI_CLUSTER_QUEUE,
  );

  createClusterQueue(chart, "kueue-gate-cluster-queue", CI_GATE_CLUSTER_QUEUE, {
    ...CI_ADMISSION_BUDGET.gateQuota,
    pods: String(CI_GATE_WORKFLOWS),
  });
  createLocalQueue(
    chart,
    "kueue-gate-local-queue",
    CI_GATE_LOCAL_QUEUE,
    CI_GATE_CLUSTER_QUEUE,
  );

  // These priorities order admission only. All CI pods retain the existing
  // batch-low Kubernetes priority and preemption remains disabled.
  for (const [name, value] of Object.entries(CI_ADMISSION_BUDGET.priorities)) {
    new WorkloadPriorityClassV1Beta2(chart, `kueue-priority-${name}`, {
      metadata: { name: `ci-${name}`, annotations: SYNC_WAVE },
      value,
      description: `Admission priority for ${name} CI work`,
    });
  }

  // The maintenance worker is a long-running pod in the CI namespace. Its own
  // queue, sized to it alone, keeps it from ever holding CI quota -- and CI
  // from ever starving it.
  createClusterQueue(
    chart,
    "kueue-maintenance-cluster-queue",
    CI_MAINTENANCE_CLUSTER_QUEUE,
    { cpu: "1", memory: "2Gi", pods: "1", "ephemeral-storage": "2Gi" },
  );
  createLocalQueue(
    chart,
    "kueue-maintenance-local-queue",
    CI_MAINTENANCE_LOCAL_QUEUE,
    CI_MAINTENANCE_CLUSTER_QUEUE,
  );

  // The Delivery chart owns the LocalQueues that feed this queue.
  new ClusterQueueV1Beta2(chart, "kueue-delivery-cluster-queue", {
    metadata: { name: DELIVERY_CLUSTER_QUEUE, annotations: SYNC_WAVE },
    spec: {
      namespaceSelector: {
        matchExpressions: [
          {
            key: "kubernetes.io/metadata.name",
            operator: "In",
            values: DELIVERY_JOB_NAMESPACES,
          },
        ],
      },
      preemption: NEVER_PREEMPT,
      resourceGroups: resourceGroups({ ...DELIVERY_STAGE_REQUESTS, pods: "1" }),
    },
  });
}

function resourceGroups(quotas: Readonly<Record<string, string>>) {
  return [
    {
      coveredResources: COVERED_RESOURCES,
      flavors: [
        {
          name: "default",
          resources: COVERED_RESOURCES.map((resource) => ({
            name: resource,
            nominalQuota: NominalQuota.fromString(
              requireQuota(quotas, resource),
            ),
          })),
        },
      ],
    },
  ];
}

function createClusterQueue(
  chart: Chart,
  id: string,
  name: string,
  quotas: Readonly<Record<string, string>>,
): void {
  new ClusterQueueV1Beta2(chart, id, {
    metadata: { name, annotations: SYNC_WAVE },
    spec: {
      namespaceSelector:
        name === CI_CLUSTER_QUEUE
          ? {
              matchExpressions: [
                {
                  key: "kubernetes.io/metadata.name",
                  operator: "In",
                  values: [
                    WOODPECKER_CI_NAMESPACE,
                    "delivery-worker-jobs",
                    "delivery-platform-jobs",
                  ],
                },
              ],
            }
          : {
              matchLabels: {
                "kubernetes.io/metadata.name": WOODPECKER_CI_NAMESPACE,
              },
            },
      preemption: NEVER_PREEMPT,
      resourceGroups: resourceGroups(quotas),
    },
  });
}

function requireQuota(
  quotas: Readonly<Record<string, string>>,
  resource: string,
): string {
  const value = quotas[resource];
  if (value === undefined) {
    throw new Error(`no quota for covered resource ${resource}`);
  }
  return value;
}

function createLocalQueue(
  chart: Chart,
  id: string,
  name: string,
  clusterQueue: string,
): void {
  new LocalQueueV1Beta2(chart, id, {
    metadata: {
      name,
      namespace: WOODPECKER_CI_NAMESPACE,
      annotations: SYNC_WAVE,
    },
    spec: { clusterQueue },
  });
}
