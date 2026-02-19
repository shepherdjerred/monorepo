import { z } from "zod";

/**
 * Default values for charts that have required fields with no defaults.
 * These minimal values allow helm template to render without errors.
 */
const CHART_DEFAULT_VALUES: Record<string, Record<string, unknown>> = {
  loki: {
    loki: {
      storage: {
        bucketNames: {
          chunks: "chunks",
          ruler: "ruler",
          admin: "admin",
        },
        type: "filesystem",
      },
    },
  },
  gitlab: {
    global: {
      hosts: {
        domain: "example.com",
      },
    },
    "certmanager-issuer": {
      email: "admin@example.com",
    },
  },
  "kube-prometheus-stack": {
    // Usually works without extra values, but add common ones
    prometheus: {
      prometheusSpec: {
        retention: "10d",
      },
    },
  },
};

/**
 * Get default values for a chart if it has required fields
 */
export function getDefaultValuesForChart(
  chartName: string,
): Record<string, unknown> | null {
  return CHART_DEFAULT_VALUES[chartName] ?? null;
}

// Zod schemas for K8s manifest parsing
const ContainerSchema = z.looseObject({
  image: z.string().optional(),
});

const ContainersArraySchema = z.array(ContainerSchema);

export const PodSpecSchema = z.looseObject({
  containers: ContainersArraySchema.optional(),
  initContainers: ContainersArraySchema.optional(),
  ephemeralContainers: ContainersArraySchema.optional(),
});

export const PodTemplateSpecSchema = z.looseObject({
  spec: PodSpecSchema.optional(),
});

const JobSpecSchema = z.looseObject({
  template: PodTemplateSpecSchema.optional(),
});

export const CronJobSpecSchema = z.looseObject({
  jobTemplate: z
    .looseObject({
      spec: JobSpecSchema.optional(),
    })
    .optional(),
});

export const PrometheusCRDSpecSchema = z.looseObject({
  image: z.string().optional(),
  thanos: z
    .looseObject({
      image: z.string().optional(),
    })
    .optional(),
  configReloaderImage: z.string().optional(),
  containers: ContainersArraySchema.optional(),
});

export const K8sManifestSchema = z.looseObject({
  kind: z.string().optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
});

// Schema for recursive image extraction
export const RecursiveImageSchema = z.looseObject({
  image: z.string().optional(),
});
