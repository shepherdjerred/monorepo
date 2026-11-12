import { z } from "zod";

/**
 * The containers of a rendered workload manifest and whether each declares
 * CPU and memory requests. Shared by the resource backstops over the
 * synthesized charts and over the upstream charts ArgoCD renders with Helm.
 */

const QuantitySchema = z.union([z.string(), z.number()]).optional();

const ContainerSchema = z.object({
  name: z.string().optional(),
  resources: z
    .object({
      requests: z
        .object({ cpu: QuantitySchema, memory: QuantitySchema })
        .optional(),
      limits: z
        .object({ cpu: QuantitySchema, memory: QuantitySchema })
        .optional(),
    })
    .loose()
    .optional(),
});
export type ContainerResources = z.infer<typeof ContainerSchema>["resources"];

const PodSpecSchema = z.object({
  priorityClassName: z.string().optional(),
  containers: z.array(ContainerSchema).optional(),
  initContainers: z.array(ContainerSchema).optional(),
});

const PodTemplateSchema = z.object({ spec: PodSpecSchema.optional() });

const WorkloadSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string().optional() }).optional(),
  spec: z
    .object({
      template: PodTemplateSchema.optional(),
      jobTemplate: z
        .object({
          spec: z.object({ template: PodTemplateSchema.optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

const WORKLOAD_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
]);

export type FoundContainer = {
  workload: string;
  container: string;
  kind: string;
  init: boolean;
  hasRequests: boolean;
  resources: ContainerResources;
  priorityClassName: string | undefined;
};

/**
 * A manifest's main and init containers. Empty for anything that is not a
 * pod-bearing workload, including the non-resource documents a chart renders.
 */
export function workloadContainers(manifest: unknown): FoundContainer[] {
  const result = WorkloadSchema.safeParse(manifest);
  if (!result.success || !WORKLOAD_KINDS.has(result.data.kind)) return [];
  const workload = result.data;
  const podSpec =
    workload.spec?.template?.spec ??
    workload.spec?.jobTemplate?.spec?.template?.spec;
  if (!podSpec) return [];
  const name = workload.metadata?.name ?? "<unnamed>";
  const toFound = (
    container: z.infer<typeof ContainerSchema>,
    init: boolean,
  ): FoundContainer => {
    const requests = container.resources?.requests;
    return {
      workload: name,
      container: container.name ?? "<unnamed>",
      kind: workload.kind,
      init,
      hasRequests: requests?.cpu != null && requests.memory != null,
      resources: container.resources,
      priorityClassName: podSpec.priorityClassName,
    };
  };
  return [
    ...(podSpec.containers ?? []).map((c) => toFound(c, false)),
    ...(podSpec.initContainers ?? []).map((c) => toFound(c, true)),
  ];
}
