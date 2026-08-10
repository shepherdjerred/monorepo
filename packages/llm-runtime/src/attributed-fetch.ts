import { z } from "zod";
import type { OpenRouterEndpoint } from "@shepherdjerred/llm-models";
import type { RuntimeFetch } from "./types.ts";

const JsonObjectSchema = z.record(z.string(), z.unknown());

export type AttributedResponseObservation = {
  workload: string;
  requestedModel: string | undefined;
  responseBody: unknown;
  responseStatus: number | undefined;
  traceId: string | undefined;
  durationMs: number;
  endpoint: OpenRouterEndpoint | "unknown";
};

export type AttributedResponseObserver = (input: {
  observationId: string | undefined;
  observation: Promise<AttributedResponseObservation>;
}) => void;

const INTERNAL_HEADERS = {
  workload: "x-sjerred-llm-workload",
  session: "x-sjerred-llm-session",
  traceId: "x-sjerred-llm-trace-id",
  parentSpanId: "x-sjerred-llm-parent-span-id",
  traceName: "x-sjerred-llm-trace-name",
  observationId: "x-sjerred-llm-observation-id",
} as const;

function optionalHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  headers.delete(name);
  return value ?? undefined;
}

export function attributionHeaders(input: {
  workload: string;
  sessionId?: string | undefined;
  traceId?: string | undefined;
  parentSpanId?: string | undefined;
  traceName?: string | undefined;
  observationId?: string | undefined;
}): Record<string, string> {
  return {
    [INTERNAL_HEADERS.workload]: input.workload,
    ...(input.sessionId === undefined
      ? {}
      : { [INTERNAL_HEADERS.session]: input.sessionId }),
    ...(input.traceId === undefined
      ? {}
      : { [INTERNAL_HEADERS.traceId]: input.traceId }),
    ...(input.parentSpanId === undefined
      ? {}
      : { [INTERNAL_HEADERS.parentSpanId]: input.parentSpanId }),
    ...(input.traceName === undefined
      ? {}
      : { [INTERNAL_HEADERS.traceName]: input.traceName }),
    ...(input.observationId === undefined
      ? {}
      : { [INTERNAL_HEADERS.observationId]: input.observationId }),
  };
}

function jsonValue(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

function sseFinalMetadata(text: string): unknown {
  let lastValue: unknown;
  let metadataValue: unknown;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (data === "" || data === "[DONE]") continue;
    const value = jsonValue(data);
    if (value === undefined) continue;
    lastValue = value;
    const record = JsonObjectSchema.safeParse(value);
    if (record.success && record.data["openrouter_metadata"] !== undefined) {
      metadataValue = value;
    }
  }
  return metadataValue ?? lastValue;
}

async function inspectResponse(input: {
  response: {
    text: () => Promise<string>;
    headers: { get: (name: string) => string | null };
    status: number;
  };
  workload: string;
  requestedModel: string | undefined;
  traceId: string | undefined;
  startedAt: number;
  endpoint: OpenRouterEndpoint | "unknown";
}): Promise<AttributedResponseObservation> {
  let responseBody: unknown;
  try {
    const text = await input.response.text();
    responseBody =
      input.response.headers
        .get("content-type")
        ?.toLowerCase()
        .includes("text/event-stream") === true
        ? sseFinalMetadata(text)
        : jsonValue(text);
  } catch {
    responseBody = undefined;
  }
  return {
    workload: input.workload,
    requestedModel: input.requestedModel,
    responseBody,
    responseStatus: input.response.status,
    traceId: input.traceId,
    durationMs: performance.now() - input.startedAt,
    endpoint: input.endpoint,
  };
}

function requestEndpoint(
  input: Parameters<typeof fetch>[0],
): OpenRouterEndpoint | "unknown" {
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    return "unknown";
  }
  if (pathname.endsWith("/chat/completions")) return "language";
  if (pathname.endsWith("/embeddings")) return "embedding";
  if (pathname.endsWith("/images/generations")) return "image";
  return "unknown";
}

export function createAttributedFetch(
  baseFetch: RuntimeFetch,
  observer?: AttributedResponseObserver,
): typeof fetch {
  const attributed = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const workload = optionalHeader(headers, INTERNAL_HEADERS.workload);
    if (workload === undefined) {
      return baseFetch(input, init);
    }
    if (typeof init?.body !== "string") {
      throw new TypeError(
        "OpenRouter attributed requests require a JSON string body",
      );
    }

    const body = JsonObjectSchema.parse(JSON.parse(init.body));
    const sessionId = optionalHeader(headers, INTERNAL_HEADERS.session);
    const traceId = optionalHeader(headers, INTERNAL_HEADERS.traceId);
    const parentSpanId = optionalHeader(headers, INTERNAL_HEADERS.parentSpanId);
    const traceName = optionalHeader(headers, INTERNAL_HEADERS.traceName);
    const observationId = optionalHeader(
      headers,
      INTERNAL_HEADERS.observationId,
    );
    const traceFields: Record<string, string> = { generation_name: workload };
    if (traceId !== undefined) traceFields["trace_id"] = traceId;
    if (parentSpanId !== undefined)
      traceFields["parent_span_id"] = parentSpanId;
    if (traceName !== undefined) traceFields["trace_name"] = traceName;
    body["trace"] = traceFields;
    if (sessionId !== undefined) body["session_id"] = sessionId;

    const requestedModel =
      typeof body["model"] === "string" ? body["model"] : undefined;
    const startedAt = performance.now();
    const endpoint = requestEndpoint(input);
    try {
      const response = await baseFetch(input, {
        ...init,
        headers,
        body: JSON.stringify(body),
      });
      observer?.({
        observationId,
        observation: inspectResponse({
          response: response.clone(),
          workload,
          requestedModel,
          traceId,
          startedAt,
          endpoint,
        }),
      });
      return response;
    } catch (error: unknown) {
      observer?.({
        observationId,
        observation: Promise.resolve({
          workload,
          requestedModel,
          responseBody: undefined,
          responseStatus: undefined,
          traceId,
          durationMs: performance.now() - startedAt,
          endpoint,
        }),
      });
      throw error;
    }
  };

  return Object.assign(attributed, { preconnect: fetch.preconnect });
}
