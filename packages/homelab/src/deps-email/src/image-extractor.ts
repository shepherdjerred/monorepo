import { parseAllDocuments } from "yaml";
import { z } from "zod";
import type { ImageRef } from "./types.ts";
import { parseImageString } from "./types.ts";
import {
  getDefaultValuesForChart,
  PodSpecSchema,
  PodTemplateSpecSchema,
  CronJobSpecSchema,
  PrometheusCRDSpecSchema,
  K8sManifestSchema,
  RecursiveImageSchema,
} from "./image-extractor-schemas.ts";

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
  const manifests = await renderHelmTemplate(
    chartName,
    registryUrl,
    version,
    values,
  );
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
  const repoName = `temp-${chartName.replaceAll(/[^a-z0-9]/gi, "-")}-${String(Date.now())}`;

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
      manifests.push(doc.toJS());
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

/** Kinds that use PodTemplateSpec in spec.template */
const POD_TEMPLATE_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Job",
]);

/** Kinds that use Prometheus Operator CRD spec pattern */
const PROMETHEUS_CRD_KINDS = new Set([
  "Prometheus",
  "Alertmanager",
  "ThanosRuler",
]);

/**
 * Extract images from a single K8s manifest based on its kind
 */
function extractImagesFromManifest(
  kind: string,
  spec: Record<string, unknown>,
  images: ImageRef[],
): void {
  if (POD_TEMPLATE_KINDS.has(kind)) {
    const templateParsed = PodTemplateSpecSchema.safeParse(spec["template"]);
    if (templateParsed.success) {
      extractFromPodSpec(templateParsed.data.spec, images);
    }
    return;
  }

  if (kind === "CronJob") {
    const cronJobParsed = CronJobSpecSchema.safeParse(spec);
    const jobSpec = cronJobParsed.success ? cronJobParsed.data.jobTemplate?.spec : undefined;
    const cronTemplateParsed = jobSpec
      ? PodTemplateSpecSchema.safeParse(jobSpec.template)
      : undefined;
    if (cronTemplateParsed?.success === true) {
      extractFromPodSpec(cronTemplateParsed.data.spec, images);
    }
    return;
  }

  if (kind === "Pod") {
    const podSpecParsed = PodSpecSchema.safeParse(spec);
    if (podSpecParsed.success) {
      extractFromPodSpec(podSpecParsed.data, images);
    }
    return;
  }

  if (PROMETHEUS_CRD_KINDS.has(kind)) {
    const crdParsed = PrometheusCRDSpecSchema.safeParse(spec);
    if (crdParsed.success) {
      extractCRDImage(crdParsed.data, images);
    }
    return;
  }

  // Try generic extraction for unknown types
  extractImagesRecursively(spec, images);
}

/**
 * Extract all images from parsed K8s manifests
 */
function extractImagesFromManifests(manifests: unknown[]): ImageRef[] {
  const images: ImageRef[] = [];

  for (const manifest of manifests) {
    const parsed = K8sManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      continue;
    }

    const { kind, spec } = parsed.data;

    if (spec && kind !== undefined) {
      extractImagesFromManifest(kind, spec, images);
    }
  }

  return images;
}

/**
 * Extract images from a PodSpec (using Zod-validated data)
 */
function extractFromPodSpec(
  podSpec: z.infer<typeof PodSpecSchema> | undefined,
  images: ImageRef[],
): void {
  if (!podSpec) {
    return;
  }

  // Main containers
  if (podSpec.containers) {
    for (const container of podSpec.containers) {
      if (container.image != null && container.image !== "") {
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
      if (container.image != null && container.image !== "") {
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
      if (container.image != null && container.image !== "") {
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
function extractCRDImage(
  spec: z.infer<typeof PrometheusCRDSpecSchema>,
  images: ImageRef[],
): void {
  // Direct image field (Prometheus, Alertmanager)
  if (spec.image != null && spec.image !== "") {
    const parsed = parseImageString(spec.image);
    if (parsed) {
      images.push(parsed);
    }
  }

  // Thanos sidecar
  if (spec.thanos?.image != null && spec.thanos.image !== "") {
    const parsed = parseImageString(spec.thanos.image);
    if (parsed) {
      images.push(parsed);
    }
  }

  // Config reloader
  if (spec.configReloaderImage != null && spec.configReloaderImage !== "") {
    const parsed = parseImageString(spec.configReloaderImage);
    if (parsed) {
      images.push(parsed);
    }
  }

  // Containers array (some CRDs have this)
  if (spec.containers) {
    for (const container of spec.containers) {
      if (container.image != null && container.image !== "") {
        const parsed = parseImageString(container.image);
        if (parsed) {
          images.push(parsed);
        }
      }
    }
  }
}

/**
 * Recursively extract images from any object structure
 * Used as fallback for unknown resource types
 */
function extractImagesRecursively(
  obj: unknown,
  images: ImageRef[],
  depth = 0,
): void {
  // Prevent infinite recursion
  if (depth > 10) {
    return;
  }

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
  if (!objResult.success) {
    return;
  }

  const record = objResult.data;

  // Check for image field
  if (record.image != null && record.image !== "") {
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

  return [...seen.values()];
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
