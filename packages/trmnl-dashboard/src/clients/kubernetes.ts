import { z } from "zod";

const NodeListSchema = z.object({
  items: z.array(
    z.object({
      status: z.object({
        conditions: z.array(
          z.object({
            type: z.string(),
            status: z.string(),
          }),
        ),
      }),
    }),
  ),
});

const ContainerStateSchema = z.object({
  waiting: z
    .object({
      reason: z.string().optional(),
    })
    .optional(),
  terminated: z
    .object({
      reason: z.string().optional(),
      exitCode: z.number().optional(),
    })
    .optional(),
  running: z.object({}).optional(),
});

const ContainerStatusSchema = z.object({
  ready: z.boolean().optional(),
  state: ContainerStateSchema.optional(),
});

const PodListSchema = z.object({
  items: z.array(
    z.object({
      status: z.object({
        phase: z.string().optional(),
        containerStatuses: z.array(ContainerStatusSchema).optional(),
        initContainerStatuses: z.array(ContainerStatusSchema).optional(),
      }),
    }),
  ),
});

type Pod = z.infer<typeof PodListSchema>["items"][number];

// A container counts as unhealthy if it is waiting with a known-bad reason
// (CrashLoopBackOff, ImagePullBackOff, ErrImagePull, CreateContainerConfigError,
// CreateContainerError) or terminated with a non-zero exit code.
const UNHEALTHY_WAIT_REASONS = new Set([
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
  "CreateContainerError",
  "InvalidImageName",
  "RunContainerError",
]);

function isPodUnhealthy(pod: Pod): boolean {
  const phase = pod.status.phase ?? "";
  if (phase === "Succeeded") return false;
  if (phase === "Pending" || phase === "Failed" || phase === "Unknown")
    return true;

  const allContainers = [
    ...(pod.status.containerStatuses ?? []),
    ...(pod.status.initContainerStatuses ?? []),
  ];
  return allContainers.some((c) => {
    const waitReason = c.state?.waiting?.reason;
    if (waitReason !== undefined && UNHEALTHY_WAIT_REASONS.has(waitReason)) {
      return true;
    }
    const exit = c.state?.terminated?.exitCode;
    if (exit !== undefined && exit !== 0) return true;
    return false;
  });
}

export type KubernetesSummary = {
  readyNodes: number;
  totalNodes: number;
  unhealthyPods: number;
};

type FetchInitWithTls = RequestInit & {
  tls?: {
    ca?: string;
  };
};

export class KubernetesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokenPath: string,
    private readonly caPath: string,
  ) {}

  async getSummary(): Promise<KubernetesSummary> {
    const [nodes, pods] = await Promise.all([
      this.fetchJson("/api/v1/nodes"),
      this.fetchJson("/api/v1/pods"),
    ]);
    const parsedNodes = NodeListSchema.parse(nodes).items;
    const parsedPods = PodListSchema.parse(pods).items;
    return {
      totalNodes: parsedNodes.length,
      readyNodes: parsedNodes.filter((node) =>
        node.status.conditions.some(
          (condition) =>
            condition.type === "Ready" && condition.status === "True",
        ),
      ).length,
      unhealthyPods: parsedPods.filter(isPodUnhealthy).length,
    };
  }

  private async fetchJson(path: string): Promise<unknown> {
    const token = await Bun.file(this.tokenPath).text();
    const init: FetchInitWithTls = {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/json",
      },
    };

    const caFile = Bun.file(this.caPath);
    if (await caFile.exists()) {
      init.tls = { ca: await caFile.text() };
    }

    const response = await fetch(new URL(path, this.baseUrl), init);
    if (!response.ok) {
      throw new Error(
        `Kubernetes API request failed: ${response.status.toString()}`,
      );
    }
    return response.json();
  }
}
