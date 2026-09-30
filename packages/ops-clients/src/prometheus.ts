import { z } from "zod";
import { fetchJson, type Fetch } from "@shepherdjerred/ops-clients/http.ts";

// Prometheus answers 200 with status="error" for bad queries. Pin the literal
// so a query error fails at parse time instead of looking like "no samples".
const SampleValueSchema = z.tuple([z.number(), z.string()]);

const VectorResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.literal("vector"),
    result: z.array(
      z.object({
        metric: z.record(z.string(), z.string()).default({}),
        value: SampleValueSchema,
      }),
    ),
  }),
});

const MatrixResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.literal("matrix"),
    result: z.array(
      z.object({
        metric: z.record(z.string(), z.string()).default({}),
        values: z.array(SampleValueSchema),
      }),
    ),
  }),
});

export type PrometheusSample = {
  metric: Record<string, string>;
  value: number;
};

export type PrometheusSeries = {
  metric: Record<string, string>;
  /** `[unix seconds, value]` pairs; non-finite values are dropped. */
  points: [number, number][];
};

export type RangeQuery = {
  query: string;
  start: Date;
  end: Date;
  stepSeconds: number;
};

export class PrometheusClient {
  readonly #baseUrl: string;
  readonly #fetch: Fetch;

  constructor(options: { baseUrl: string; fetch?: Fetch }) {
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch ?? fetch;
  }

  /** Instant vector query; each sample's value is parsed to a number. */
  async query(
    query: string,
    signal?: AbortSignal,
  ): Promise<PrometheusSample[]> {
    const url = new URL("/api/v1/query", this.#baseUrl);
    url.searchParams.set("query", query);
    const response = await fetchJson(
      this.#fetch,
      { upstream: "prometheus", url, ...(signal ? { signal } : {}) },
      VectorResponseSchema,
    );
    return response.data.result.map((sample) => ({
      metric: sample.metric,
      value: Number(sample.value[1]),
    }));
  }

  /**
   * The single value of a query expected to return at most one sample.
   * No samples (or a non-finite value) is `null`: the query had no data.
   */
  async scalar(query: string, signal?: AbortSignal): Promise<number | null> {
    const samples = await this.query(query, signal);
    if (samples.length > 1) {
      throw new Error(
        `Prometheus scalar query returned ${String(samples.length)} samples: ${query}`,
      );
    }
    const value = samples[0]?.value;
    return value === undefined || !Number.isFinite(value) ? null : value;
  }

  async range(
    request: RangeQuery,
    signal?: AbortSignal,
  ): Promise<PrometheusSeries[]> {
    const url = new URL("/api/v1/query_range", this.#baseUrl);
    url.searchParams.set("query", request.query);
    url.searchParams.set("start", String(request.start.getTime() / 1000));
    url.searchParams.set("end", String(request.end.getTime() / 1000));
    url.searchParams.set("step", String(request.stepSeconds));
    const response = await fetchJson(
      this.#fetch,
      { upstream: "prometheus", url, ...(signal ? { signal } : {}) },
      MatrixResponseSchema,
    );
    return response.data.result.map((series) => ({
      metric: series.metric,
      points: series.values
        .map(([time, value]): [number, number] => [time, Number(value)])
        .filter(([, value]) => Number.isFinite(value)),
    }));
  }
}
