import { z } from "zod/v4";
import type { ReportEnvelopeV1 } from "#shared/report.ts";

const MetadataSchema = z.object({ name: z.string(), namespace: z.string() });
const PodSchema = z.object({
  kind: z.literal("Pod"),
  metadata: MetadataSchema,
  status: z.object({
    phase: z.string(),
    containerStatuses: z
      .array(
        z.object({
          name: z.string(),
          ready: z.boolean(),
          restartCount: z.number().int().nonnegative(),
        }),
      )
      .optional(),
  }),
});
const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: MetadataSchema,
  spec: z.object({ replicas: z.number().int().nonnegative().optional() }),
  status: z.object({
    availableReplicas: z.number().int().nonnegative().optional(),
    updatedReplicas: z.number().int().nonnegative().optional(),
  }),
});
const StatefulSetSchema = z.object({
  kind: z.literal("StatefulSet"),
  metadata: MetadataSchema,
  spec: z.object({ replicas: z.number().int().nonnegative().optional() }),
  status: z.object({
    readyReplicas: z.number().int().nonnegative().optional(),
  }),
});
const DaemonSetSchema = z.object({
  kind: z.literal("DaemonSet"),
  metadata: MetadataSchema,
  status: z.object({
    desiredNumberScheduled: z.number().int().nonnegative(),
    numberAvailable: z.number().int().nonnegative().optional(),
    updatedNumberScheduled: z.number().int().nonnegative().optional(),
  }),
});

export const KubernetesWorkloadListSchema = z.object({
  items: z.array(
    z.discriminatedUnion("kind", [
      PodSchema,
      DeploymentSchema,
      StatefulSetSchema,
      DaemonSetSchema,
    ]),
  ),
});

type Finding = ReportEnvelopeV1["findings"][number];
type Pod = z.infer<typeof PodSchema>;
type Deployment = z.infer<typeof DeploymentSchema>;
type StatefulSet = z.infer<typeof StatefulSetSchema>;
type DaemonSet = z.infer<typeof DaemonSetSchema>;

function podFinding(pod: Pod): Finding | undefined {
  const failed =
    !["Running", "Succeeded"].includes(pod.status.phase) ||
    (pod.status.phase === "Running" &&
      pod.status.containerStatuses?.some((container) => !container.ready) ===
        true);
  if (!failed) return undefined;
  return {
    severity: "warning",
    summary: `${pod.metadata.namespace}/${pod.metadata.name} Pod is ${pod.status.phase}`,
    detail: pod.status.containerStatuses
      ?.map(
        (container) =>
          `${container.name}: ready=${String(container.ready)} restarts=${container.restartCount.toString()}`,
      )
      .join(", "),
    evidenceReceiptIds: [],
  };
}

function deploymentFinding(deployment: Deployment): Finding | undefined {
  const desired = deployment.spec.replicas ?? 1;
  const available = deployment.status.availableReplicas ?? 0;
  const updated = deployment.status.updatedReplicas ?? 0;
  if (available >= desired && updated >= desired) return undefined;
  return {
    severity: "warning",
    summary: `${deployment.metadata.namespace}/${deployment.metadata.name} Deployment has unavailable replicas`,
    detail: `desired=${desired.toString()}; available=${available.toString()}; updated=${updated.toString()}`,
    evidenceReceiptIds: [],
  };
}

function statefulSetFinding(statefulSet: StatefulSet): Finding | undefined {
  const desired = statefulSet.spec.replicas ?? 1;
  const ready = statefulSet.status.readyReplicas ?? 0;
  if (ready >= desired) return undefined;
  return {
    severity: "warning",
    summary: `${statefulSet.metadata.namespace}/${statefulSet.metadata.name} StatefulSet has unavailable replicas`,
    detail: `desired=${desired.toString()}; ready=${ready.toString()}`,
    evidenceReceiptIds: [],
  };
}

function daemonSetFinding(daemonSet: DaemonSet): Finding | undefined {
  const desired = daemonSet.status.desiredNumberScheduled;
  const available = daemonSet.status.numberAvailable ?? 0;
  const updated = daemonSet.status.updatedNumberScheduled ?? 0;
  if (available >= desired && updated >= desired) return undefined;
  return {
    severity: "warning",
    summary: `${daemonSet.metadata.namespace}/${daemonSet.metadata.name} DaemonSet has unavailable pods`,
    detail: `desired=${desired.toString()}; available=${available.toString()}; updated=${updated.toString()}`,
    evidenceReceiptIds: [],
  };
}

function workloadFinding(
  workload: z.infer<typeof KubernetesWorkloadListSchema>["items"][number],
): Finding | undefined {
  if (workload.kind === "Pod") return podFinding(workload);
  if (workload.kind === "Deployment") return deploymentFinding(workload);
  if (workload.kind === "StatefulSet") return statefulSetFinding(workload);
  return daemonSetFinding(workload);
}

export function interpretKubernetesWorkloads(
  workloads: z.infer<typeof KubernetesWorkloadListSchema>,
): { summary: string; findings: Finding[] } {
  const findings = workloads.items.flatMap((workload) => {
    const finding = workloadFinding(workload);
    return finding === undefined ? [] : [finding];
  });
  return {
    summary: `${findings.length.toString()} unhealthy of ${workloads.items.length.toString()} workloads`,
    findings,
  };
}
