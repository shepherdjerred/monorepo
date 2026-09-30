import { z } from "zod";
import { fetchJson, type Fetch } from "@shepherdjerred/ops-clients/http.ts";

const TraceSummarySchema = z.object({
  traceID: z.string().min(1),
  // Tempo omits root fields while a trace's root span has not arrived yet.
  rootServiceName: z.string().optional(),
  rootTraceName: z.string().optional(),
  // Unix nanoseconds as a decimal string (too large for a JS number).
  startTimeUnixNano: z.string().regex(/^\d{7,}$/),
  // Tempo omits the duration of sub-millisecond traces.
  durationMs: z.number().nonnegative().optional(),
});

const SearchResponseSchema = z.object({
  traces: z.array(TraceSummarySchema).default([]),
});

export type TraceSummary = {
  traceId: string;
  /** `service.name` of the root span, or `undefined` if it has not arrived. */
  rootServiceName: string | undefined;
  rootTraceName: string | undefined;
  startedAt: Date;
  durationMs: number;
};

export type TraceSearch = {
  traces: TraceSummary[];
  /** True when Tempo returned a full page, so counts are lower bounds. */
  truncated: boolean;
};

/** TraceQL for traces containing an errored span. */
export function errorTraceQuery(): string {
  return "{ status = error }";
}

/** TraceQL for traces longer than the given number of seconds. */
export function slowTraceQuery(seconds: number): string {
  return `{ duration > ${String(seconds)}s }`;
}

/** Read-only Tempo client for TraceQL search. */
export class TempoClient {
  readonly #baseUrl: string;
  readonly #fetch: Fetch;

  constructor(options: { baseUrl: string; fetch?: Fetch }) {
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch ?? fetch;
  }

  async search(request: {
    query: string;
    start: Date;
    end: Date;
    limit: number;
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
    const body = await fetchJson(
      this.#fetch,
      { upstream: "tempo", url, timeoutMs: 30_000 },
      SearchResponseSchema,
    );
    return {
      traces: body.traces.map((trace) => ({
        traceId: trace.traceID,
        rootServiceName: trace.rootServiceName,
        rootTraceName: trace.rootTraceName,
        startedAt: new Date(Number(trace.startTimeUnixNano.slice(0, -6))),
        durationMs: trace.durationMs ?? 0,
      })),
      truncated: body.traces.length >= request.limit,
    };
  }
}
