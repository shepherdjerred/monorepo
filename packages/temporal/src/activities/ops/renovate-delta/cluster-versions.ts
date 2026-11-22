import {
  bearer,
  fetchJson,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";
import {
  KubernetesClient,
  type ArgoApplication,
  type NodeStatus,
  type PodStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import { z } from "zod";
import {
  normalizeImageRepo,
  normalizeVersionString,
  parseContainerImageReference,
} from "./semver-utils.ts";

const RawContainerImageSchema = z.object({ image: z.string().optional() });

const RawPodContainersSchema = z.object({
  metadata: z
    .object({ continue: z.string().optional() })
    .optional()
    .default({}),
  items: z.array(
    z.object({
      spec: z
        .object({
          containers: z.array(RawContainerImageSchema).optional(),
          initContainers: z.array(RawContainerImageSchema).optional(),
        })
        .optional(),
      status: z
        .object({
          containerStatuses: z.array(RawContainerImageSchema).optional(),
        })
        .optional(),
    }),
  ),
});

const RawArgoSourceSchema = z.object({
  chart: z.string().optional(),
  targetRevision: z.string().optional(),
});

const RawArgoApplicationsSchema = z.object({
  metadata: z
    .object({ continue: z.string().optional() })
    .optional()
    .default({}),
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string() }),
      spec: z
        .object({
          source: RawArgoSourceSchema.optional(),
          sources: z.array(RawArgoSourceSchema).optional(),
        })
        .optional(),
      status: z
        .object({
          sync: z
            .object({
              revision: z.string().optional(),
              revisions: z.array(z.string()).optional(),
            })
            .optional(),
          summary: z
            .object({
              images: z.array(z.string()).optional(),
            })
            .optional(),
        })
        .optional(),
    }),
  ),
});

export type LiveClusterSnapshot = {
  readonly podImages: readonly string[];
  readonly argoImages: readonly string[];
  readonly argoChartVersions: ReadonlyMap<string, string>;
  readonly kubeletVersion: string | null;
  readonly talosVersion: string | null;
};

export const EMPTY_CLUSTER_SNAPSHOT: LiveClusterSnapshot = {
  podImages: [],
  argoImages: [],
  argoChartVersions: new Map(),
  kubeletVersion: null,
  talosVersion: null,
};

const GitShaPattern = /^[0-9a-f]{40}$/iu;
const TalosOsImagePattern =
  /talos\s*\(?v?(\d+\.\d+(?:\.\d+)?(?:-[0-9a-z.-]+)?)\)?/iu;

const KUBERNETES_PACKAGE_NAMES = new Set([
  "kubernetes",
  "kubernetes/kubernetes",
  "k8s.io/kubernetes",
  "siderolabs/kubelet",
  "kubelet",
]);

const TALOS_PACKAGE_NAMES = new Set([
  "talos",
  "siderolabs/talos",
  "ghcr.io/siderolabs/installer",
  "siderolabs/installer",
  "siderolabs/installer-liskov",
  "siderolabs/installer-torvalds",
]);

function extractTalosVersion(nodes: readonly NodeStatus[]): string | null {
  for (const node of nodes) {
    const match = TalosOsImagePattern.exec(node.osImage);
    if (match?.[1] !== undefined) {
      return normalizeVersionString(match[1]);
    }
  }
  return null;
}

function extractKubeletVersion(nodes: readonly NodeStatus[]): string | null {
  for (const node of nodes) {
    const cleaned = normalizeVersionString(node.kubeletVersion);
    if (cleaned !== null) {
      return cleaned;
    }
  }
  return null;
}

function isNonShaRevision(revision: string | undefined): string | null {
  return revision === undefined || GitShaPattern.test(revision.trim())
    ? null
    : normalizeVersionString(revision);
}

function addArgoClientApps(
  apps: readonly ArgoApplication[],
  chartVersions: Map<string, string>,
): void {
  for (const app of apps) {
    const rev = isNonShaRevision(app.revision);
    if (rev !== null) {
      chartVersions.set(app.name.toLowerCase(), rev);
    }
  }
}

async function fetchPaginatedK8s<T extends z.ZodType>(input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly token: () => Promise<string>;
  readonly fetchImpl: Fetch;
  readonly schema: T;
  readonly getNext: (page: z.infer<T>) => string | undefined;
}): Promise<z.infer<T>[]> {
  const pages: z.infer<T>[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(input.path, input.baseUrl);
    url.searchParams.set("limit", "500");
    for (const [key, val] of Object.entries(input.query ?? {})) {
      url.searchParams.set(key, val);
    }
    if (cursor !== undefined) {
      url.searchParams.set("continue", cursor);
    }
    const page = await fetchJson(
      input.fetchImpl,
      {
        upstream: "kubernetes",
        url,
        init: {
          headers: {
            accept: "application/json",
            ...bearer(await input.token()),
          },
        },
      },
      input.schema,
    );
    pages.push(page);
    const next = input.getNext(page);
    cursor = next === undefined || next === "" ? undefined : next;
  } while (cursor !== undefined);
  return pages;
}

function collectSinglePodImages(
  pod: z.infer<typeof RawPodContainersSchema>["items"][number],
  images: Set<string>,
): void {
  const allContainers = [
    ...(pod.spec?.containers ?? []),
    ...(pod.spec?.initContainers ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ];
  for (const container of allContainers) {
    if (container.image !== undefined) {
      images.add(container.image);
    }
  }
}

function extractRawPodImages(
  pages: readonly z.infer<typeof RawPodContainersSchema>[],
): string[] {
  const images = new Set<string>();
  for (const page of pages) {
    for (const pod of page.items) {
      collectSinglePodImages(pod, images);
    }
  }
  return [...images];
}

function extractRawArgoDetails(
  pages: readonly z.infer<typeof RawArgoApplicationsSchema>[],
  chartVersions: Map<string, string>,
): string[] {
  const argoImages = new Set<string>();
  for (const page of pages) {
    for (const app of page.items) {
      for (const img of app.status?.summary?.images ?? []) {
        argoImages.add(img);
      }
      collectRawArgoSourceVersions(app, chartVersions);
    }
  }
  return [...argoImages];
}

function collectRawArgoSourceVersions(
  app: z.infer<typeof RawArgoApplicationsSchema>["items"][number],
  chartVersions: Map<string, string>,
): void {
  const singleChart = app.spec?.source?.chart;
  if (singleChart !== undefined) {
    const rev =
      isNonShaRevision(app.status?.sync?.revision) ??
      isNonShaRevision(app.spec?.source?.targetRevision);
    if (rev !== null) {
      chartVersions.set(singleChart.toLowerCase(), rev);
      chartVersions.set(app.metadata.name.toLowerCase(), rev);
    }
  }
  const sources = app.spec?.sources ?? [];
  const revisions = app.status?.sync?.revisions ?? [];
  for (const [idx, source] of sources.entries()) {
    if (source.chart === undefined) {
      continue;
    }
    const rev =
      isNonShaRevision(revisions[idx]) ??
      isNonShaRevision(source.targetRevision);
    if (rev !== null) {
      chartVersions.set(source.chart.toLowerCase(), rev);
    }
  }
}

export type ClusterConnectionInput = {
  readonly kubernetes: Pick<
    KubernetesClient,
    "listNodes" | "listPods" | "listArgoApplications"
  >;
  readonly rawApi?: {
    readonly baseUrl: string;
    readonly token: () => Promise<string>;
    readonly fetchImpl?: Fetch;
  };
};

export async function collectLiveClusterSnapshot(
  connection: ClusterConnectionInput,
): Promise<LiveClusterSnapshot> {
  const [nodes, _pods, argoApps]: [
    NodeStatus[],
    PodStatus[],
    ArgoApplication[],
  ] = await Promise.all([
    connection.kubernetes.listNodes(),
    connection.kubernetes.listPods(),
    connection.kubernetes.listArgoApplications(),
  ]);

  const chartVersions = new Map<string, string>();
  addArgoClientApps(argoApps, chartVersions);

  let podImages: string[] = [];
  let argoImages: string[] = [];

  if (connection.rawApi !== undefined) {
    const fetchImpl = connection.rawApi.fetchImpl ?? fetch;
    const [rawPodPages, rawArgoPages] = await Promise.all([
      fetchPaginatedK8s({
        baseUrl: connection.rawApi.baseUrl,
        path: "/api/v1/pods",
        query: { fieldSelector: "status.phase!=Succeeded" },
        token: connection.rawApi.token,
        fetchImpl,
        schema: RawPodContainersSchema,
        getNext: (p) => p.metadata.continue,
      }),
      fetchPaginatedK8s({
        baseUrl: connection.rawApi.baseUrl,
        path: "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications",
        token: connection.rawApi.token,
        fetchImpl,
        schema: RawArgoApplicationsSchema,
        getNext: (p) => p.metadata.continue,
      }),
    ]);
    podImages = extractRawPodImages(rawPodPages);
    argoImages = extractRawArgoDetails(rawArgoPages, chartVersions);
  }

  return {
    podImages,
    argoImages,
    argoChartVersions: chartVersions,
    kubeletVersion: extractKubeletVersion(nodes),
    talosVersion: extractTalosVersion(nodes),
  };
}

export function createInClusterConnection(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): ClusterConnectionInput | undefined {
  const host = env["KUBERNETES_SERVICE_HOST"]?.trim();
  const port = env["KUBERNETES_SERVICE_PORT"]?.trim();
  if (host === undefined || host === "" || port === undefined || port === "") {
    return undefined;
  }
  const serviceAccountDir = "/var/run/secrets/kubernetes.io/serviceaccount";
  const baseUrl = `https://${host}:${port}`;
  const clusterFetch: Fetch = async (input, init) => {
    const ca = await Bun.file(`${serviceAccountDir}/ca.crt`).text();
    return await fetch(input, { ...init, tls: { ca } });
  };
  const token = async () => {
    const raw = await Bun.file(`${serviceAccountDir}/token`).text();
    return raw.trim();
  };
  return {
    kubernetes: new KubernetesClient({
      baseUrl,
      token,
      fetch: clusterFetch,
    }),
    rawApi: {
      baseUrl,
      token,
      fetchImpl: clusterFetch,
    },
  };
}

function buildImageVersionIndex(
  images: readonly string[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const image of images) {
    const parsed = parseContainerImageReference(image);
    const version = parsed?.version;
    if (parsed === null || version === undefined || version === null) {
      continue;
    }
    if (!index.has(parsed.repository)) {
      index.set(parsed.repository, version);
    }
    const slashIdx = parsed.repository.lastIndexOf("/");
    if (slashIdx !== -1) {
      const basename = parsed.repository.slice(slashIdx + 1);
      if (!index.has(`basename:${basename}`)) {
        index.set(`basename:${basename}`, version);
      }
    }
  }
  return index;
}

function resolveNodePlatformVersion(
  candidates: readonly string[],
  snapshot: LiveClusterSnapshot,
): { readonly version: string | null } | undefined {
  for (const candidate of candidates) {
    const lower = candidate.trim().toLowerCase();
    if (KUBERNETES_PACKAGE_NAMES.has(lower)) {
      return { version: snapshot.kubeletVersion };
    }
    if (TALOS_PACKAGE_NAMES.has(lower)) {
      return { version: snapshot.talosVersion };
    }
  }
  return undefined;
}

function resolveChartOrContainerVersion(
  candidates: readonly string[],
  ecosystem: string | undefined,
  snapshot: LiveClusterSnapshot,
): string | null {
  for (const candidate of candidates) {
    const chartMatch = snapshot.argoChartVersions.get(
      candidate.trim().toLowerCase(),
    );
    if (chartMatch !== undefined) {
      return chartMatch;
    }
  }

  const podIndex = buildImageVersionIndex(snapshot.podImages);
  const argoIndex = buildImageVersionIndex(snapshot.argoImages);

  for (const candidate of candidates) {
    const repo = normalizeImageRepo(candidate);
    const exact = podIndex.get(repo) ?? argoIndex.get(repo);
    if (exact !== undefined) {
      return exact;
    }
  }

  if (ecosystem !== "docker" && ecosystem !== "helm") {
    return null;
  }
  for (const candidate of candidates) {
    const repo = normalizeImageRepo(candidate);
    if (!repo.includes("/")) {
      const byBase =
        podIndex.get(`basename:${repo}`) ?? argoIndex.get(`basename:${repo}`);
      if (byBase !== undefined) {
        return byBase;
      }
    }
  }
  return null;
}

export function resolveRunningVersion(input: {
  readonly packageName: string;
  readonly aliases?: readonly string[];
  readonly ecosystem?: string;
  readonly snapshot: LiveClusterSnapshot;
}): string | null {
  const candidates = [input.packageName, ...(input.aliases ?? [])];
  const nodePlatform = resolveNodePlatformVersion(candidates, input.snapshot);
  return nodePlatform === undefined
    ? resolveChartOrContainerVersion(
        candidates,
        input.ecosystem,
        input.snapshot,
      )
    : nodePlatform.version;
}
