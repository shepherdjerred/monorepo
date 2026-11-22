import { z } from "zod";
import {
  fetchJson,
  UpstreamError,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

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

const PrometheusRulesJsonSchema = z.object({
  data: z.object({
    groups: z.array(
      z.object({
        rules: z.array(z.unknown()),
      }),
    ),
  }),
});

const LokiNamespacedRulesJsonSchema = z.record(
  z.string(),
  z.array(
    z.object({
      rules: z.array(z.unknown()),
    }),
  ),
);

/** Loki's structured/detected severity, never words embedded in a message. */
export const ERROR_LEVEL_FILTER = 'detected_level=~"error|fatal|critical"';

export const NAMESPACE_BYTES_24H_QUERY =
  'sum by (namespace) (bytes_over_time({namespace=~".+"}[24h]))';

export const WARNING_EVENTS_1H_QUERY =
  'sum by (namespace, reason) (count_over_time({app="kubernetes-events", type="Warning"}[1h]))';

export function errorLogQuery(namespaceSelector: string): string {
  return `{${namespaceSelector}} | ${ERROR_LEVEL_FILTER}`;
}

/** LogQL for error lines per namespace over a window such as `1h`. */
export function errorVolumeQuery(window: string): string {
  return `sum by (namespace) (count_over_time(${errorLogQuery('namespace=~".+"')} [${window}]))`;
}

export type NamespaceLogVolume = { namespace: string; lines: number };

export type NamespaceByteVolume = { namespace: string; bytes: number };

export type KubernetesWarningEventCount = {
  namespace: string;
  reason: string;
  count: number;
};

function countRulesFromBody(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "" || /^no rule groups found$/iu.test(trimmed)) {
    return 0;
  }
  if (trimmed.startsWith("{")) {
    let jsonValue: unknown;
    try {
      jsonValue = JSON.parse(trimmed);
    } catch {
      throw new UpstreamError("loki", "invalid JSON from /loki/api/v1/rules");
    }
    const promParsed = PrometheusRulesJsonSchema.safeParse(jsonValue);
    if (promParsed.success) {
      return promParsed.data.data.groups.reduce(
        (sum, group) => sum + group.rules.length,
        0,
      );
    }
    const lokiParsed = LokiNamespacedRulesJsonSchema.safeParse(jsonValue);
    if (lokiParsed.success) {
      return Object.values(lokiParsed.data).reduce(
        (sum, groups) =>
          sum + groups.reduce((inner, group) => inner + group.rules.length, 0),
        0,
      );
    }
    throw new UpstreamError("loki", "unexpected rules JSON shape");
  }
  const matches = trimmed.match(/^\s*(?:-\s*)?(?:alert|record)\s*:\s*\S+/gmu);
  return matches?.length ?? 0;
}

/** Read-only Loki client for metric (instant vector) LogQL queries and ruler inspection. */
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

  /** Total log bytes ingested per namespace over the last 24 hours, largest first. */
  async namespaceVolume24h(time = new Date()): Promise<NamespaceByteVolume[]> {
    const samples = await this.instant(NAMESPACE_BYTES_24H_QUERY, time);
    return samples
      .map((sample) => ({
        namespace: sample.metric["namespace"] ?? "",
        bytes: sample.value,
      }))
      .filter((row) => row.namespace !== "" && Number.isFinite(row.bytes))
      .toSorted((left, right) => right.bytes - left.bytes);
  }

  /** Kubernetes Warning events grouped by `(namespace, reason)` over 1h; graceful empty array when absent. */
  async warningEvents1h(
    time = new Date(),
  ): Promise<KubernetesWarningEventCount[]> {
    let samples: { metric: Record<string, string>; value: number }[];
    try {
      samples = await this.instant(WARNING_EVENTS_1H_QUERY, time);
    } catch (error) {
      const upstreamErr = z.instanceof(UpstreamError).safeParse(error);
      if (
        upstreamErr.success &&
        (upstreamErr.data.status === 400 || upstreamErr.data.status === 404)
      ) {
        return [];
      }
      throw error;
    }
    return samples
      .map((sample) => {
        const rawNamespace = sample.metric["namespace"] ?? "";
        return {
          namespace: rawNamespace === "" ? "(cluster)" : rawNamespace,
          reason: sample.metric["reason"] ?? "",
          count: sample.value,
        };
      })
      .filter(
        (row) =>
          row.reason !== "" && row.count > 0 && Number.isFinite(row.count),
      )
      .toSorted((left, right) => right.count - left.count);
  }

  /** Count configured Loki ruler rules across groups, returning `0` on 404. */
  async rulerRulesCount(): Promise<number> {
    const url = new URL("/loki/api/v1/rules", this.#baseUrl);
    const response = await this.#fetch(url, {
      headers: { accept: "application/yaml, application/json;q=0.9" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return 0;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError(
        "loki",
        `HTTP ${String(response.status)}`,
        response.status,
      );
    }
    return countRulesFromBody(await response.text());
  }
}
