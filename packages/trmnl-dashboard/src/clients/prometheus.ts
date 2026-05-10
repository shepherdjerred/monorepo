import { z } from "zod";

const PrometheusVectorResponse = z.object({
  status: z.string(),
  data: z.object({
    result: z.array(
      z.object({
        metric: z.record(z.string(), z.string()).default({}),
        value: z.tuple([z.number(), z.string()]),
      }),
    ),
  }),
});

export type PrometheusSample = {
  metric: Record<string, string>;
  value: number;
};

export class PrometheusClient {
  constructor(private readonly baseUrl: string) {}

  async query(query: string): Promise<PrometheusSample[]> {
    const url = new URL("/api/v1/query", this.baseUrl);
    url.searchParams.set("query", query);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Prometheus query failed: ${response.status.toString()}`);
    }

    const parsed = PrometheusVectorResponse.parse(await response.json());
    return parsed.data.result.map((sample) => ({
      metric: sample.metric,
      value: Number(sample.value[1]),
    }));
  }

  async scalar(query: string): Promise<number | null> {
    const samples = await this.query(query);
    const value = samples[0]?.value;
    return value == null || !Number.isFinite(value) ? null : value;
  }
}
