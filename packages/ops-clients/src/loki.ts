import { z } from "zod";
import { fetchJson, type Fetch } from "@shepherdjerred/ops-clients/http.ts";

const LokiVectorSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.literal("vector"),
    result: z.array(
      z.object({
        metric: z.record(z.string(), z.string()).default({}),
        value: z.tuple([z.number(), z.string()]),
      }),
    ),
  }),
});

/** Case-insensitive error markers counted as error log lines. */
export const ERROR_LINE_PATTERN = String.raw`(?i)\b(error|fatal|panic|exception)\b`;

/** LogQL for error lines per namespace over a window such as `1h`. */
export function errorVolumeQuery(window: string): string {
  return `sum by (namespace) (count_over_time({namespace=~".+"} |~ \`${ERROR_LINE_PATTERN}\` [${window}]))`;
}

export type NamespaceLogVolume = { namespace: string; lines: number };

/** Read-only Loki client for metric (instant vector) LogQL queries. */
export class LokiClient {
  readonly #baseUrl: string;
  readonly #fetch: Fetch;

  constructor(options: { baseUrl: string; fetch?: Fetch }) {
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch ?? fetch;
  }

  async instant(
    query: string,
    time: Date,
  ): Promise<{ metric: Record<string, string>; value: number }[]> {
    const url = new URL("/loki/api/v1/query", this.#baseUrl);
    url.searchParams.set("query", query);
    url.searchParams.set("time", String(time.getTime() * 1_000_000));
    const body = await fetchJson(
      this.#fetch,
      { upstream: "loki", url, timeoutMs: 30_000 },
      LokiVectorSchema,
    );
    return body.data.result.map((sample) => ({
      metric: sample.metric,
      value: Number(sample.value[1]),
    }));
  }

  /** Error log lines per namespace, largest first. */
  async errorVolumeByNamespace(
    window: string,
    time: Date,
  ): Promise<NamespaceLogVolume[]> {
    const samples = await this.instant(errorVolumeQuery(window), time);
    return samples
      .map((sample) => ({
        namespace: sample.metric["namespace"] ?? "",
        lines: sample.value,
      }))
      .filter((row) => row.namespace !== "" && Number.isFinite(row.lines))
      .toSorted((left, right) => right.lines - left.lines);
  }
}
