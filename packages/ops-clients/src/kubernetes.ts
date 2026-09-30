import { z } from "zod";
import {
  bearer,
  fetchJson,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

/** Supplies the bearer token per request so a rotated projected token is picked up. */
export type TokenProvider = () => Promise<string>;

const ListMetadataSchema = z.object({
  continue: z.string().optional(),
});

const ConditionSchema = z.object({
  type: z.string(),
  status: z.string(),
  lastTransitionTime: z.string().nullable().optional(),
});

const NodeSchema = z.object({
  metadata: z.object({ name: z.string() }),
  status: z.object({
    conditions: z.array(ConditionSchema).default([]),
    nodeInfo: z.object({
      osImage: z.string(),
      kubeletVersion: z.string(),
    }),
  }),
});

const ContainerStatusSchema = z.object({
  name: z.string(),
  ready: z.boolean(),
  restartCount: z.number().int().nonnegative(),
  state: z
    .object({
      waiting: z.object({ reason: z.string().optional() }).optional(),
      terminated: z.object({ reason: z.string().optional() }).optional(),
    })
    .optional(),
});

const PodSchema = z.object({
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    creationTimestamp: z.string(),
    ownerReferences: z.array(z.object({ kind: z.string() })).optional(),
  }),
  status: z.object({
    phase: z.enum(["Pending", "Running", "Succeeded", "Failed", "Unknown"]),
    reason: z.string().optional(),
    startTime: z.string().optional(),
    containerStatuses: z.array(ContainerStatusSchema).optional(),
    initContainerStatuses: z.array(ContainerStatusSchema).optional(),
  }),
});

const ArgoHistorySchema = z.object({
  id: z.number().int(),
  revision: z.string().optional(),
  revisions: z.array(z.string()).optional(),
  deployedAt: z.string(),
  deployStartedAt: z.string().optional(),
});

const ArgoSyncStatusSchema = z.enum(["Synced", "OutOfSync", "Unknown"]);
const ArgoHealthStatusSchema = z.enum([
  "Healthy",
  "Progressing",
  "Degraded",
  "Suspended",
  "Missing",
  "Unknown",
]);

const ArgoApplicationSchema = z.object({
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({
    project: z.string(),
    destination: z.object({ namespace: z.string().optional() }),
  }),
  status: z
    .object({
      sync: z
        .object({
          status: ArgoSyncStatusSchema,
          revision: z.string().optional(),
        })
        .optional(),
      health: z.object({ status: ArgoHealthStatusSchema }).optional(),
      history: z.array(ArgoHistorySchema).optional(),
      reconciledAt: z.string().optional(),
      operationState: z
        .object({
          phase: z.string(),
          message: z.string().optional(),
          startedAt: z.string(),
          finishedAt: z.string().optional(),
        })
        .optional(),
    })
    .default({}),
});

function listSchema<T extends z.ZodType>(item: T) {
  return z.object({
    metadata: ListMetadataSchema.default({}),
    items: z.array(item),
  });
}

export type NodeStatus = {
  name: string;
  ready: boolean;
  /** When the Ready condition last changed. */
  readySince: string | undefined;
  osImage: string;
  kubeletVersion: string;
};

export type PodStatus = {
  namespace: string;
  name: string;
  phase: z.infer<typeof PodSchema>["status"]["phase"];
  createdAt: string;
  ownerKind: string | undefined;
  restarts: number;
  /** Set when the pod needs attention; `undefined` means healthy. */
  problem: string | undefined;
  /** A container is stuck in a waiting state that never resolves alone. */
  stuck: boolean;
};

export type ArgoSyncStatus = z.infer<typeof ArgoSyncStatusSchema>;
export type ArgoHealthStatus = z.infer<typeof ArgoHealthStatusSchema>;

export type ArgoApplication = {
  name: string;
  project: string;
  destinationNamespace: string | undefined;
  sync: ArgoSyncStatus;
  health: ArgoHealthStatus;
  revision: string | undefined;
  history: {
    id: number;
    revision: string | undefined;
    deployedAt: string;
    deployStartedAt: string | undefined;
  }[];
  operation:
    | {
        phase: string;
        message: string | undefined;
        startedAt: string;
        finishedAt: string | undefined;
      }
    | undefined;
};

/** Container waiting reasons that never resolve on their own. */
export const STUCK_WAITING_REASONS: ReadonlySet<string> = new Set([
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
  "CreateContainerError",
  "InvalidImageName",
  "RunContainerError",
]);

function stuckContainer(pod: z.infer<typeof PodSchema>): string | undefined {
  const containers = [
    ...(pod.status.initContainerStatuses ?? []),
    ...(pod.status.containerStatuses ?? []),
  ];
  for (const container of containers) {
    const reason = container.state?.waiting?.reason;
    if (reason !== undefined && STUCK_WAITING_REASONS.has(reason)) {
      return `${container.name}: ${reason}`;
    }
  }
  return undefined;
}

/**
 * Why a pod needs attention, or `undefined` when it is healthy. Running and
 * Succeeded pods are healthy unless a container is stuck waiting.
 */
export function podProblem(pod: z.infer<typeof PodSchema>): string | undefined {
  const stuck = stuckContainer(pod);
  if (stuck !== undefined) {
    return stuck;
  }
  const settled =
    pod.status.phase === "Running" || pod.status.phase === "Succeeded";
  return settled ? undefined : (pod.status.reason ?? pod.status.phase);
}

function toPodStatus(pod: z.infer<typeof PodSchema>): PodStatus {
  return {
    namespace: pod.metadata.namespace,
    name: pod.metadata.name,
    phase: pod.status.phase,
    createdAt: pod.metadata.creationTimestamp,
    ownerKind: pod.metadata.ownerReferences?.[0]?.kind,
    restarts: (pod.status.containerStatuses ?? []).reduce(
      (total, container) => total + container.restartCount,
      0,
    ),
    problem: podProblem(pod),
    stuck: stuckContainer(pod) !== undefined,
  };
}

function toArgoApplication(
  app: z.infer<typeof ArgoApplicationSchema>,
): ArgoApplication {
  const operation = app.status.operationState;
  return {
    name: app.metadata.name,
    project: app.spec.project,
    destinationNamespace: app.spec.destination.namespace,
    // A freshly created Application has no status yet; Argo itself reports
    // that as Unknown.
    sync: app.status.sync?.status ?? "Unknown",
    health: app.status.health?.status ?? "Unknown",
    revision: app.status.sync?.revision,
    history: (app.status.history ?? []).map((entry) => ({
      id: entry.id,
      revision: entry.revision ?? entry.revisions?.[0],
      deployedAt: entry.deployedAt,
      deployStartedAt: entry.deployStartedAt,
    })),
    operation:
      operation === undefined
        ? undefined
        : {
            phase: operation.phase,
            message: operation.message,
            startedAt: operation.startedAt,
            finishedAt: operation.finishedAt,
          },
  };
}

const PAGE_SIZE = 500;

/**
 * Read-only Kubernetes API client for nodes, pods, and ArgoCD Applications.
 * Callers inject the token provider and `fetch`, so the in-cluster CA and
 * service-account token stay the caller's concern.
 */
export class KubernetesClient {
  readonly #baseUrl: string;
  readonly #token: TokenProvider;
  readonly #fetch: Fetch;

  constructor(options: {
    baseUrl: string;
    token: TokenProvider;
    fetch?: Fetch;
  }) {
    this.#baseUrl = options.baseUrl;
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  async #list<T extends z.ZodType>(
    path: string,
    item: T,
    parameters: Record<string, string> = {},
  ): Promise<z.infer<T>[]> {
    const items: z.infer<T>[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL(path, this.#baseUrl);
      url.searchParams.set("limit", String(PAGE_SIZE));
      for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.set(key, value);
      }
      if (cursor !== undefined) {
        url.searchParams.set("continue", cursor);
      }
      const page = await fetchJson(
        this.#fetch,
        {
          upstream: "kubernetes",
          url,
          init: {
            headers: {
              accept: "application/json",
              ...bearer(await this.#token()),
            },
          },
        },
        listSchema(item),
      );
      items.push(...page.items);
      cursor =
        page.metadata.continue === undefined || page.metadata.continue === ""
          ? undefined
          : page.metadata.continue;
    } while (cursor !== undefined);
    return items;
  }

  async listNodes(): Promise<NodeStatus[]> {
    const nodes = await this.#list("/api/v1/nodes", NodeSchema);
    return nodes.map((node) => {
      const ready = node.status.conditions.find(
        (condition) => condition.type === "Ready",
      );
      return {
        name: node.metadata.name,
        ready: ready?.status === "True",
        readySince: ready?.lastTransitionTime ?? undefined,
        osImage: node.status.nodeInfo.osImage,
        kubeletVersion: node.status.nodeInfo.kubeletVersion,
      };
    });
  }

  /** Every pod that has not completed, across all namespaces. */
  async listPods(): Promise<PodStatus[]> {
    const pods = await this.#list("/api/v1/pods", PodSchema, {
      fieldSelector: "status.phase!=Succeeded",
    });
    return pods.map((pod) => toPodStatus(pod));
  }

  async listArgoApplications(namespace = "argocd"): Promise<ArgoApplication[]> {
    const apps = await this.#list(
      `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/applications`,
      ArgoApplicationSchema,
    );
    return apps.map((app) => toArgoApplication(app));
  }
}
