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

const PodListSchema = z.object({
  items: z.array(
    z.object({
      status: z.object({
        phase: z.string().optional(),
      }),
    }),
  ),
});

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
      this.fetchJson(
        "/api/v1/pods?fieldSelector=status.phase!=Running,status.phase!=Succeeded",
      ),
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
      unhealthyPods: parsedPods.length,
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
