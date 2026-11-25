import {
  fetchJson,
  UpstreamError,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";
import {
  mapSearchTrace,
  normalizeRawTrace,
  RawTraceResponseSchema,
  TempoSearchResponseSchema,
} from "@shepherdjerred/ops-clients/tempo-otlp.ts";

export type TraceSummary = {
  traceId: string;
  /** `service.name` of the root span, or `undefined` if it has not arrived. */
  rootServiceName: string | undefined;
  rootTraceName: string | undefined;
  startedAt: Date;
  durationMs: number;
  spanCount?: number | undefined;
  errorCount?: number | undefined;
  environment?: string | null | undefined;
  workloads?: string[] | undefined;
  providers?: string[] | undefined;
  models?: string[] | undefined;
  subject?: { kind: string; id: string } | null | undefined;
  inputTokens?: number | null | undefined;
  outputTokens?: number | null | undefined;
  cachedInputTokens?: number | null | undefined;
  hasToolIo?: boolean | undefined;
};

export type TraceSearch = {
  traces: TraceSummary[];
  /** True when Tempo returned a full page, so counts are lower bounds. */
  truncated: boolean;
};

export type OtlpSpanStatus = "ok" | "error" | "unset";

export type OtlpSpanEvent = {
  name: string;
  timeUnixNano: string;
  attributes: Record<string, unknown>;
};

export type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind?: number | string | undefined;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: OtlpSpanStatus;
  statusMessage: string | null;
  serviceName: string;
  scopeName: string | null;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
  events: OtlpSpanEvent[];
};

export type OtlpTrace = {
  traceId: string;
  spans: OtlpSpan[];
};

export type LlmTraceQlFilters = {
  service?: string | undefined;
  environment?: string | undefined;
  workload?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  status?: "all" | "ok" | "error" | undefined;
  subjectId?: string | undefined;
  minDurationMs?: number | undefined;
};

/** TraceQL for traces containing an errored span. */
export function errorTraceQuery(): string {
  return "{ status = error }";
}

/** TraceQL for traces longer than the given number of seconds. */
export function slowTraceQuery(seconds: number): string {
  return `{ duration > ${String(seconds)}s }`;
}

function escapeTraceQlString(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code === 0x7f || code <= 0x1f) {
      throw new Error(
        "TraceQL string literal must not contain control characters",
      );
    }
  }
  return value.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
}

const BASE_LLM_SELECTOR =
  'span.gen_ai.system != "" || span.gen_ai.operation.name != "" || span.gen_ai.request.model != ""';

function pushStringFilterClauses(
  clauses: string[],
  filters: LlmTraceQlFilters,
): void {
  if (filters.service !== undefined && filters.service !== "") {
    const escaped = escapeTraceQlString(filters.service);
    clauses.push(
      `(resource.service.name = "${escaped}" || span.llm.service = "${escaped}")`,
    );
  }
  if (filters.environment !== undefined && filters.environment !== "") {
    const escaped = escapeTraceQlString(filters.environment);
    clauses.push(
      `(resource.deployment.environment.name = "${escaped}" || resource.deployment.environment = "${escaped}")`,
    );
  }
  if (filters.workload !== undefined && filters.workload !== "") {
    clauses.push(
      `span.llm.call_site = "${escapeTraceQlString(filters.workload)}"`,
    );
  }
  if (filters.provider !== undefined && filters.provider !== "") {
    const escaped = escapeTraceQlString(filters.provider);
    clauses.push(
      `(span.gen_ai.system = "${escaped}" || span.gen_ai.provider.name = "${escaped}")`,
    );
  }
  if (filters.model !== undefined && filters.model !== "") {
    const escaped = escapeTraceQlString(filters.model);
    clauses.push(
      `(span.gen_ai.request.model = "${escaped}" || span.gen_ai.response.model = "${escaped}")`,
    );
  }
  if (filters.subjectId !== undefined && filters.subjectId !== "") {
    clauses.push(
      `span.llm.subject.id = "${escapeTraceQlString(filters.subjectId)}"`,
    );
  }
}

/** Build a TraceQL query targeting repository LLM traces with optional filters. */
export function buildLlmTraceQl(filters: LlmTraceQlFilters): string {
  const clauses: string[] = [];
  pushStringFilterClauses(clauses, filters);

  if (filters.status === "error") {
    clauses.push("status = error");
  } else if (filters.status === "ok") {
    clauses.push("status = ok");
  }
  if (filters.minDurationMs !== undefined) {
    if (!Number.isFinite(filters.minDurationMs) || filters.minDurationMs < 0) {
      throw new Error("minDurationMs must be a finite non-negative number");
    }
    if (filters.minDurationMs > 0) {
      clauses.push(
        `duration >= ${String(Math.round(filters.minDurationMs))}ms`,
      );
    }
  }

  return clauses.length === 0
    ? `{ ${BASE_LLM_SELECTOR} }`
    : `{ (${BASE_LLM_SELECTOR}) && ${clauses.join(" && ")} }`;
}

/** Read-only Tempo client for TraceQL search, trace retrieval, and health checks. */
export class TempoClient {
  readonly #baseUrl: string;
  readonly #fetch: Fetch;

  constructor(options: { baseUrl: string; fetch?: Fetch }) {
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch ?? fetch;
  }

  async health(): Promise<boolean> {
    const url = new URL("/ready", this.#baseUrl);
    try {
      const response = await this.#fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  async search(request: {
    query: string;
    start: Date;
    end: Date;
    limit: number;
    spss?: number | undefined;
  }): Promise<TraceSearch> {
    const url = new URL("/api/search", this.#baseUrl);
    url.searchParams.set("q", request.query);
    url.searchParams.set(
      "start",
      String(Math.floor(request.start.getTime() / 1000)),
    );
    url.searchParams.set(
      "end",
      String(Math.floor(request.end.getTime() / 1000)),
    );
    url.searchParams.set("limit", String(request.limit));
    if (request.spss !== undefined) {
      url.searchParams.set("spss", String(request.spss));
    }
    const body = await fetchJson(
      this.#fetch,
      { upstream: "tempo", url, timeoutMs: 30_000 },
      TempoSearchResponseSchema,
    );
    return {
      traces: body.traces.map((trace) => mapSearchTrace(trace)),
      truncated: body.traces.length >= request.limit,
    };
  }

  async getTrace(traceId: string): Promise<OtlpTrace | null> {
    const url = new URL(
      `/api/traces/${encodeURIComponent(traceId)}`,
      this.#baseUrl,
    );
    const response = await this.#fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError(
        "tempo",
        `HTTP ${String(response.status)}`,
        response.status,
      );
    }
    const rawBody: unknown = await response.json();
    const parsed = RawTraceResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      const paths = parsed.error.issues
        .slice(0, 3)
        .map((issue) => issue.path.join(".") || "(root)")
        .join(", ");
      throw new UpstreamError(
        "tempo",
        `response did not match schema at ${paths}`,
      );
    }
    return normalizeRawTrace(traceId, parsed.data);
  }
}
