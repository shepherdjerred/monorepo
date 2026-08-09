import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import type { PreviewPort } from "#application/ports";
import {
  PreviewsSchema,
  type AlertDetail,
  type PreviewInput,
  type Previews,
} from "#shared/schema";

const GrafanaDataSchema = z.json();
const TraceIdSchema = z.string().regex(/^(?:[0-9a-f]{16}|[0-9a-f]{32})$/iu);
const QuerySchema = z.string().trim().min(1).max(2000);
const SafeLabelValueSchema = z
  .string()
  .max(200)
  .regex(/^[\w.:/@+-]+$/u);

type GrafanaPreviewOptions = {
  baseUrl: string;
  token: string;
  prometheusUid: string;
  lokiUid: string;
  tempoUid: string;
  allowedGeneratorHosts: readonly string[];
};

type PreviewResult = Previews["prometheus"];

export class GrafanaPreviewClient implements PreviewPort {
  readonly #options: GrafanaPreviewOptions;

  constructor(options: GrafanaPreviewOptions) {
    this.#options = {
      ...options,
      baseUrl: z.url().parse(options.baseUrl).replace(/\/$/u, ""),
    };
  }

  async health(): Promise<boolean> {
    const response = await fetch(`${this.#options.baseUrl}/api/health`, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  }

  async previews(input: PreviewInput, alert: AlertDetail): Promise<Previews> {
    const from = Temporal.Instant.from(input.from);
    const to = Temporal.Instant.from(input.to);
    if (Temporal.Instant.compare(from, to) >= 0)
      throw new Error("Preview start must precede end");
    if (to.since(from).total({ unit: "hours" }) > 24)
      throw new Error("Preview range exceeds 24 hours");
    const [prometheus, loki, tempo] = await Promise.all([
      this.#capture(() => this.#prometheus(alert, from, to)),
      this.#capture(() => this.#loki(alert, from, to)),
      this.#capture(() => this.#tempo(alert)),
    ]);
    return PreviewsSchema.parse({ prometheus, loki, tempo });
  }

  async #capture(load: () => Promise<PreviewResult>): Promise<PreviewResult> {
    try {
      return await load();
    } catch (error) {
      return {
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #prometheus(
    alert: AlertDetail,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<PreviewResult> {
    const query = this.#prometheusQuery(alert);
    if (query === null)
      return {
        status: "unavailable",
        reason: "No safe Prometheus query metadata",
      };
    const intervalSeconds = Math.max(
      1,
      Math.ceil(to.since(from).total({ unit: "seconds" }) / 1000),
    );
    const url = this.#datasourceUrl(
      this.#options.prometheusUid,
      "/api/v1/query_range",
    );
    url.searchParams.set("query", query);
    url.searchParams.set("start", String(from.epochMilliseconds / 1000));
    url.searchParams.set("end", String(to.epochMilliseconds / 1000));
    url.searchParams.set("step", String(intervalSeconds));
    return { status: "available", query, data: await this.#get(url) };
  }

  async #loki(
    alert: AlertDetail,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<PreviewResult> {
    const candidates = [
      { key: "service_name", value: alert.labels["service_name"] },
      { key: "namespace", value: alert.labels["namespace"] },
      { key: "container", value: alert.labels["container"] },
      { key: "pod", value: alert.labels["pod"] },
    ];
    const matchers = candidates.flatMap(({ key, value }) => {
      const parsed = SafeLabelValueSchema.safeParse(value);
      return parsed.success ? [`${key}="${parsed.data}"`] : [];
    });
    const override = alert.annotations["alert_dashboard_logql"];
    const query =
      override === undefined
        ? matchers.length === 0
          ? null
          : `{${matchers.join(",")}}`
        : QuerySchema.parse(override);
    if (query === null)
      return { status: "unavailable", reason: "No safe Loki label matchers" };
    const url = this.#datasourceUrl(
      this.#options.lokiUid,
      "/loki/api/v1/query_range",
    );
    url.searchParams.set("query", query);
    url.searchParams.set("start", from.epochNanoseconds.toString());
    url.searchParams.set("end", to.epochNanoseconds.toString());
    url.searchParams.set("limit", "100");
    url.searchParams.set("direction", "backward");
    return { status: "available", query, data: await this.#get(url) };
  }

  async #tempo(alert: AlertDetail): Promise<PreviewResult> {
    const candidate =
      alert.annotations["alert_dashboard_trace_id"] ??
      alert.annotations["trace_id"] ??
      alert.labels["trace_id"];
    const parsed = TraceIdSchema.safeParse(candidate);
    if (!parsed.success)
      return { status: "unavailable", reason: "No valid trace ID metadata" };
    const url = this.#datasourceUrl(
      this.#options.tempoUid,
      `/api/traces/${parsed.data}`,
    );
    return {
      status: "available",
      query: parsed.data,
      data: await this.#get(url),
    };
  }

  #prometheusQuery(alert: AlertDetail): string | null {
    const override = alert.annotations["alert_dashboard_promql"];
    if (override !== undefined) return QuerySchema.parse(override);
    if (alert.generatorUrl === null) return null;
    const generator = new URL(alert.generatorUrl);
    if (generator.protocol !== "https:" && generator.protocol !== "http:")
      return null;
    if (!this.#options.allowedGeneratorHosts.includes(generator.hostname))
      return null;
    const expression =
      generator.searchParams.get("g0.expr") ??
      generator.searchParams.get("expr");
    return expression === null ? null : QuerySchema.parse(expression);
  }

  #datasourceUrl(uid: string, path: string): URL {
    return new URL(
      `/api/datasources/proxy/uid/${encodeURIComponent(uid)}${path}`,
      this.#options.baseUrl,
    );
  }

  #headers(): HeadersInit {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.#options.token}`,
    };
  }

  async #get(url: URL): Promise<z.infer<typeof GrafanaDataSchema>> {
    const response = await fetch(url, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    if (!response.ok)
      throw new Error(`Grafana returned ${String(response.status)}: ${body}`);
    return GrafanaDataSchema.parse(JSON.parse(body));
  }
}
