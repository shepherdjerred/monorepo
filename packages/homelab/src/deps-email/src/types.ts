import { z } from "zod";

// ============================================================================
// Chart Metadata Types
// ============================================================================

/**
 * Schema for Chart.yaml dependency entry
 */
export const ChartDependencySchema = z.object({
  name: z.string(),
  version: z.string(), // Can be semver constraint like "^1.0.0" or "1.x"
  repository: z.string().optional(), // URL or alias like "@bitnami"
  condition: z.string().optional(), // e.g., "grafana.enabled"
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  "import-values": z.array(z.unknown()).optional(),
  alias: z.string().optional(),
});

export type ChartDependency = z.infer<typeof ChartDependencySchema>;

/**
 * Schema for Chart.yaml
 */
export const ChartYamlSchema = z.object({
  apiVersion: z.enum(["v1", "v2"]),
  name: z.string(),
  version: z.string(),
  appVersion: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(ChartDependencySchema).optional(),
});

export type ChartYaml = z.infer<typeof ChartYamlSchema>;

/**
 * Schema for Chart.lock entry
 */
export const ChartLockEntrySchema = z.object({
  name: z.string(),
  version: z.string(), // Pinned exact version
  repository: z.string(),
});

export type ChartLockEntry = z.infer<typeof ChartLockEntrySchema>;

/**
 * Schema for Chart.lock
 */
export const ChartLockSchema = z.object({
  dependencies: z.array(ChartLockEntrySchema).optional(),
  digest: z.string().optional(),
  generated: z.string().optional(),
});

export type ChartLock = z.infer<typeof ChartLockSchema>;

// ============================================================================
// Image Types
// ============================================================================

/**
 * Container image reference
 */
export const ImageRefSchema = z.object({
  repository: z.string(), // e.g., "prometheus/prometheus"
  tag: z.string(), // e.g., "v3.8.0"
  registry: z.string().optional(), // e.g., "quay.io", "docker.io"
  digest: z.string().optional(), // e.g., "sha256:..."
});

export type ImageRef = z.infer<typeof ImageRefSchema>;

/**
 * Full image string representation
 */
export function imageRefToString(image: ImageRef): string {
  const registry = image.registry ? `${image.registry}/` : "";
  const tag = image.digest ? `@${image.digest}` : `:${image.tag}`;
  return `${registry}${image.repository}${tag}`;
}

/**
 * Parse an image string into ImageRef
 */
export function parseImageString(imageStr: string): ImageRef | null {
  // Handle various formats:
  // - prometheus/prometheus:v3.8.0
  // - quay.io/prometheus/prometheus:v3.8.0
  // - docker.io/grafana/grafana:12.3.0
  // - grafana/grafana@sha256:abc123

  const digestRegex = /^(.+)@(sha256:[a-f0-9]+)$/;
  const digestMatch = digestRegex.exec(imageStr);
  if (digestMatch) {
    const [, imagePart, digest] = digestMatch;
    const parsed = parseImageWithoutDigest(imagePart ?? "");
    if (parsed) {
      return { ...parsed, digest, tag: "latest" };
    }
  }

  const tagRegex = /^(.+):([^:]+)$/;
  const tagMatch = tagRegex.exec(imageStr);
  if (tagMatch) {
    const [, imagePart, tag] = tagMatch;
    const parsed = parseImageWithoutDigest(imagePart ?? "");
    if (parsed && tag) {
      return { ...parsed, tag };
    }
  }

  // No tag specified, assume latest
  const parsed = parseImageWithoutDigest(imageStr);
  if (parsed) {
    return { ...parsed, tag: "latest" };
  }

  return null;
}

function parseImageWithoutDigest(imagePart: string): Omit<ImageRef, "tag"> | null {
  const parts = imagePart.split("/");

  if (parts.length === 1) {
    // Just image name, e.g., "nginx"
    return { repository: parts[0] ?? "", registry: "docker.io" };
  }

  if (parts.length === 2) {
    // Could be registry/image or org/image
    const first = parts[0] ?? "";
    if (first.includes(".") || first === "localhost") {
      // It's a registry
      return { repository: parts[1] ?? "", registry: first };
    }
    // It's org/image (assume docker.io)
    return { repository: imagePart };
  }

  if (parts.length >= 3) {
    // registry/org/image or registry/org/subpath/image
    const registry = parts[0];
    const repository = parts.slice(1).join("/");
    return { repository, registry };
  }

  return null;
}

// ============================================================================
// Resolved Types
// ============================================================================

/**
 * Resolved chart with all metadata
 */
export type ResolvedChart = {
  name: string;
  version: string;
  appVersion?: string;
  repository: string;
  dependencies: ResolvedChart[];
  images: ImageRef[];
  depth: number;
  parent?: string;
};

/**
 * Full dependency tree
 */
export type DependencyTree = {
  root: ResolvedChart;
  flatCharts: ResolvedChart[]; // Flattened list of all charts
  flatImages: ImageRef[]; // Flattened list of all images (deduplicated)
};

// ============================================================================
// Diff Types
// ============================================================================

/**
 * Single chart version change
 */
export type ChartUpdate = {
  name: string;
  oldVersion: string;
  newVersion: string;
  oldAppVersion?: string;
  newAppVersion?: string;
  repository: string;
  depth: number;
};

/**
 * Single image version change
 */
export type ImageUpdate = {
  repository: string;
  oldTag: string;
  newTag: string;
  registry?: string;
  parentChart: string; // Which chart contains this image
};

/**
 * Full dependency diff between two chart versions
 */
export type FullDependencyDiff = {
  // Chart-level changes
  charts: {
    added: ResolvedChart[];
    removed: ResolvedChart[];
    updated: ChartUpdate[];
  };
  // Image-level changes
  images: {
    added: ImageRef[];
    removed: ImageRef[];
    updated: ImageUpdate[];
  };
  // AppVersion changes (subset of chart updates where appVersion changed)
  appVersions: {
    updated: AppVersionUpdate[];
  };
};

export type AppVersionUpdate = {
  chartName: string;
  oldAppVersion: string;
  newAppVersion: string;
};

// ============================================================================
// Release Notes Types
// ============================================================================

/**
 * Source of release notes
 */
export type ReleaseNoteSource = "github-releases" | "changelog" | "artifacthub" | "git-compare" | "llm-extracted";

/**
 * Single release note entry
 */
export type ReleaseNote = {
  version: string;
  body: string;
  url?: string;
  source: ReleaseNoteSource;
  publishedAt?: string;
};

/**
 * Release notes for a dependency
 */
export type DependencyReleaseNotes = {
  dependency: string; // e.g., "prometheus/prometheus"
  parentChart?: string; // e.g., "kube-prometheus-stack"
  notes: ReleaseNote[];
  oldVersion: string;
  newVersion: string;
};

// ============================================================================
// Helm Repository Types
// ============================================================================

/**
 * Known repository aliases
 */
export const REPO_ALIASES: Record<string, string> = {
  "@bitnami": "https://charts.bitnami.com/bitnami",
  "@grafana": "https://grafana.github.io/helm-charts",
  "@prometheus-community": "https://prometheus-community.github.io/helm-charts",
  "@jetstack": "https://charts.jetstack.io",
  "@ingress-nginx": "https://kubernetes.github.io/ingress-nginx",
};

/**
 * Resolve a repository reference to a full URL
 */
export function resolveRepositoryUrl(repoRef: string | undefined, parentRepoUrl?: string): string | null {
  if (!repoRef) {
    // Empty/undefined means bundled subchart
    return parentRepoUrl ?? null;
  }

  if (repoRef.startsWith("http://") || repoRef.startsWith("https://")) {
    return repoRef;
  }

  if (repoRef.startsWith("@")) {
    return REPO_ALIASES[repoRef] ?? null;
  }

  if (repoRef.startsWith("file://") || repoRef === "") {
    // Local subchart
    return parentRepoUrl ?? null;
  }

  return null;
}
