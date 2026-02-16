import { parseAllDocuments } from "yaml";
import { z } from "zod";
import type { ImageRef } from "./types.js";
import { parseImageString } from "./types.js";

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
function getDefaultValuesForChart(chartName: string): Record<string, unknown> | null {
  return CHART_DEFAULT_VALUES[chartName] ?? null;
}

// Zod schemas for K8s manifest parsing
const ContainerSchema = z.looseObject({
  image: z.string().optional(),
});

const ContainersArraySchema = z.array(ContainerSchema);

const PodSpecSchema = z.looseObject({
  containers: ContainersArraySchema.optional(),
  initContainers: ContainersArraySchema.optional(),
  ephemeralContainers: ContainersArraySchema.optional(),
});

const PodTemplateSpecSchema = z.looseObject({
  spec: PodSpecSchema.optional(),
});

const JobSpecSchema = z.looseObject({
  template: PodTemplateSpecSchema.optional(),
});

const CronJobSpecSchema = z.looseObject({
  jobTemplate: z
    .looseObject({
      spec: JobSpecSchema.optional(),
    })
    .optional(),
});

const PrometheusCRDSpecSchema = z.looseObject({
  image: z.string().optional(),
  thanos: z
    .looseObject({
      image: z.string().optional(),
    })
    .optional(),
  configReloaderImage: z.string().optional(),
  containers: ContainersArraySchema.optional(),
});

const K8sManifestSchema = z.looseObject({
  kind: z.string().optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Extract all container images from a Helm chart by rendering templates
 *
 * Uses `helm template` to render actual K8s manifests and extract ALL images,
 * including those in init containers, sidecars, and CRD specs.
 */
export async function extractAllImages(
  chartName: string,
  registryUrl: string,
  version: string,
  values?: Record<string, unknown>,
): Promise<ImageRef[]> {
  const manifests = await renderHelmTemplate(chartName, registryUrl, version, values);
  const images = extractImagesFromManifests(manifests);
  return deduplicateImages(images);
}

/**
 * Render Helm chart to YAML manifests using helm template
 */
async function renderHelmTemplate(
  chartName: string,
  registryUrl: string,
  version: string,
  values?: Record<string, unknown>,
): Promise<unknown[]> {
  const repoName = `temp-${chartName.replace(/[^a-zA-Z0-9]/g, "-")}-${String(Date.now())}`;

  try {
    // Add the helm repo
    const addProc = Bun.spawn(["helm", "repo", "add", repoName, registryUrl], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const addExitCode = await addProc.exited;
    if (addExitCode !== 0) {
      const stderr = await new Response(addProc.stderr).text();
      throw new Error(`helm repo add failed: ${stderr}`);
    }

    // Update repo
    const updateProc = Bun.spawn(["helm", "repo", "update", repoName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const updateExitCode = await updateProc.exited;
    if (updateExitCode !== 0) {
      const stderr = await new Response(updateProc.stderr).text();
      throw new Error(`helm repo update failed: ${stderr}`);
    }

    // Build helm template command
    // Use --dry-run=client and --no-hooks to avoid failures from missing CRDs/resources
    const templateArgs = [
      "template",
      "release-name",
      `${repoName}/${chartName}`,
      "--version",
      version,
      "--dry-run=client",
      "--no-hooks",
    ];

    // Add values if provided
    if (values) {
      const valuesJson = JSON.stringify(values);
      templateArgs.push("--set-json", valuesJson);
    }

    // Add default values for charts with required fields
    const defaultValues = getDefaultValuesForChart(chartName);
    if (defaultValues) {
      templateArgs.push("--set-json", JSON.stringify(defaultValues));
    }

    // Run helm template
    const templateProc = Bun.spawn(["helm", ...templateArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(templateProc.stdout).text();
    const exitCode = await templateProc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(templateProc.stderr).text();
      throw new Error(`helm template failed: ${stderr}`);
    }

    // Parse all YAML documents
    const documents = parseAllDocuments(output);
    const manifests: unknown[] = [];

    for (const doc of documents) {
      if (doc.toJS()) {
        manifests.push(doc.toJS());
      }
    }

    return manifests;
  } finally {
    // Clean up repo
    const removeProc = Bun.spawn(["helm", "repo", "remove", repoName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await removeProc.exited;
  }
}

/**
 * Extract all images from parsed K8s manifests
 */
function extractImagesFromManifests(manifests: unknown[]): ImageRef[] {
  const images: ImageRef[] = [];

  for (const manifest of manifests) {
    const parsed = K8sManifestSchema.safeParse(manifest);
    if (!parsed.success) continue;

    const { kind, spec } = parsed.data;

    if (spec) {
      switch (kind) {
        case "Deployment":
        case "StatefulSet":
        case "DaemonSet":
        case "ReplicaSet":
        case "Job": {
          const templateParsed = PodTemplateSpecSchema.safeParse(spec["template"]);
          if (templateParsed.success) {
            extractFromPodSpec(templateParsed.data.spec, images);
          }
          break;
        }

        case "CronJob": {
          const cronJobParsed = CronJobSpecSchema.safeParse(spec);
          if (cronJobParsed.success) {
            const jobSpec = cronJobParsed.data.jobTemplate?.spec;
            if (jobSpec) {
              const templateParsed = PodTemplateSpecSchema.safeParse(jobSpec.template);
              if (templateParsed.success) {
                extractFromPodSpec(templateParsed.data.spec, images);
              }
            }
          }
          break;
        }

        case "Pod": {
          const podSpecParsed = PodSpecSchema.safeParse(spec);
          if (podSpecParsed.success) {
            extractFromPodSpec(podSpecParsed.data, images);
          }
          break;
        }

        // CRD-specific patterns
        case "Prometheus":
        case "Alertmanager":
        case "ThanosRuler": {
          const crdParsed = PrometheusCRDSpecSchema.safeParse(spec);
          if (crdParsed.success) {
            extractCRDImage(crdParsed.data, images);
          }
          break;
        }

        default:
          // Try generic extraction for unknown types
          extractImagesRecursively(spec, images);
      }
    }
  }

  return images;
}

/**
 * Extract images from a PodSpec (using Zod-validated data)
 */
function extractFromPodSpec(podSpec: z.infer<typeof PodSpecSchema> | undefined, images: ImageRef[]): void {
  if (!podSpec) return;

  // Main containers
  if (podSpec.containers) {
    for (const container of podSpec.containers) {
      if (container.image) {
        const parsed = parseImageString(container.image);
        if (parsed) {
          images.push(parsed);
        }
      }
    }
  }

  // Init containers
  if (podSpec.initContainers) {
    for (const container of podSpec.initContainers) {
      if (container.image) {
        const parsed = parseImageString(container.image);
        if (parsed) {
          images.push(parsed);
        }
      }
    }
  }

  // Ephemeral containers
  if (podSpec.ephemeralContainers) {
    for (const container of podSpec.ephemeralContainers) {
      if (container.image) {
        const parsed = parseImageString(container.image);
        if (parsed) {
          images.push(parsed);
        }
      }
    }
  }
}

/**
 * Extract image from Prometheus Operator CRDs (using Zod-validated data)
 */
function extractCRDImage(spec: z.infer<typeof PrometheusCRDSpecSchema>, images: ImageRef[]): void {
  // Direct image field (Prometheus, Alertmanager)
  if (spec.image) {
    const parsed = parseImageString(spec.image);
    if (parsed) {
      images.push(parsed);
    }
  }

  // Thanos sidecar
  if (spec.thanos?.image) {
    const parsed = parseImageString(spec.thanos.image);
    if (parsed) {
      images.push(parsed);
    }
  }

  // Config reloader
  if (spec.configReloaderImage) {
    const parsed = parseImageString(spec.configReloaderImage);
    if (parsed) {
      images.push(parsed);
    }
  }

  // Containers array (some CRDs have this)
  if (spec.containers) {
    for (const container of spec.containers) {
      if (container.image) {
        const parsed = parseImageString(container.image);
        if (parsed) {
          images.push(parsed);
        }
      }
    }
  }
}

// Schema for recursive image extraction
const RecursiveImageSchema = z.looseObject({
  image: z.string().optional(),
});

/**
 * Recursively extract images from any object structure
 * Used as fallback for unknown resource types
 */
function extractImagesRecursively(obj: unknown, images: ImageRef[], depth = 0): void {
  // Prevent infinite recursion
  if (depth > 10) return;

  // Try to parse as array
  const arrayResult = z.array(z.unknown()).safeParse(obj);
  if (arrayResult.success) {
    for (const item of arrayResult.data) {
      extractImagesRecursively(item, images, depth + 1);
    }
    return;
  }

  // Try to parse as object with optional image field
  const objResult = RecursiveImageSchema.safeParse(obj);
  if (!objResult.success) return;

  const record = objResult.data;

  // Check for image field
  if (record.image) {
    const parsed = parseImageString(record.image);
    if (parsed) {
      images.push(parsed);
    }
  }

  // Recurse into nested objects
  for (const value of Object.values(record)) {
    if (value !== null && value !== undefined) {
      extractImagesRecursively(value, images, depth + 1);
    }
  }
}

/**
 * Deduplicate images by repository and tag
 */
function deduplicateImages(images: ImageRef[]): ImageRef[] {
  const seen = new Map<string, ImageRef>();

  for (const image of images) {
    const key = `${image.registry ?? ""}/${image.repository}:${image.tag}`;
    if (!seen.has(key)) {
      seen.set(key, image);
    }
  }

  return Array.from(seen.values());
}

/**
 * Diff two sets of images to find changes
 */
type ImageUpdateResult = {
  repository: string;
  registry?: string;
  oldTag: string;
  newTag: string;
};

export function diffImages(
  oldImages: ImageRef[],
  newImages: ImageRef[],
): {
  added: ImageRef[];
  removed: ImageRef[];
  updated: ImageUpdateResult[];
} {
  const oldMap = new Map<string, ImageRef>();
  const newMap = new Map<string, ImageRef>();

  // Key by repository (ignore tag for comparison)
  for (const img of oldImages) {
    const key = `${img.registry ?? ""}/${img.repository}`;
    oldMap.set(key, img);
  }

  for (const img of newImages) {
    const key = `${img.registry ?? ""}/${img.repository}`;
    newMap.set(key, img);
  }

  const added: ImageRef[] = [];
  const removed: ImageRef[] = [];
  const updated: ImageUpdateResult[] = [];

  // Find added and updated
  for (const [key, newImg] of newMap) {
    const oldImg = oldMap.get(key);
    if (!oldImg) {
      added.push(newImg);
    } else if (oldImg.tag !== newImg.tag) {
      updated.push({
        repository: newImg.repository,
        registry: newImg.registry,
        oldTag: oldImg.tag,
        newTag: newImg.tag,
      });
    }
  }

  // Find removed
  for (const [key, oldImg] of oldMap) {
    if (!newMap.has(key)) {
      removed.push(oldImg);
    }
  }

  return { added, removed, updated };
}
