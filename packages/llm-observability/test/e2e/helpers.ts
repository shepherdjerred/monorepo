import { gunzipSync } from "node:zlib";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { LlmArchiveSpanProcessor } from "../../src/archive-span-processor.ts";
import { type ArchiveConfig } from "../../src/archive-uploader.ts";

export const TEMPO_QUERY_URL = "http://localhost:3200";
export const TEMPO_OTLP_URL = "http://localhost:4318";
export const MINIO_ENDPOINT = "http://localhost:9000";

export const e2eArchiveConfig: ArchiveConfig = {
  bucket: "llm-archive",
  prefix: "llm",
  region: "us-east-1",
  endpoint: MINIO_ENDPOINT,
  accessKeyId: "minioadmin",
  secretAccessKey: "minioadmin",
  sessionToken: undefined,
  forcePathStyle: true,
};

export type E2eHarness = {
  provider: BasicTracerProvider;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
  rootProcessor: SpanProcessor;
};

let contextManagerEnabled = false;

function ensureContextManager(): void {
  if (contextManagerEnabled) return;
  const manager = new AsyncLocalStorageContextManager();
  manager.enable();
  context.setGlobalContextManager(manager);
  contextManagerEnabled = true;
}

export function buildE2eHarness(serviceName: string): E2eHarness {
  ensureContextManager();
  const exporter = new OTLPTraceExporter({
    url: `${TEMPO_OTLP_URL}/v1/traces`,
  });
  const batch = new BatchSpanProcessor(exporter, {
    scheduledDelayMillis: 500,
    maxExportBatchSize: 512,
    maxQueueSize: 4096,
    exportTimeoutMillis: 5000,
  });
  const archive = new LlmArchiveSpanProcessor({
    inner: batch,
    archive: e2eArchiveConfig,
  });
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "service.version": "e2e-test",
    }),
    spanProcessors: [archive],
  });
  // Set global so wrappers' getLlmTracer() picks this up.
  trace.setGlobalTracerProvider(provider);

  return {
    provider,
    rootProcessor: archive,
    async flush() {
      await archive.forceFlush();
    },
    async shutdown() {
      await archive.shutdown();
      await provider.shutdown();
    },
  };
}

/**
 * Force-flush Tempo's WAL → block, then poll the trace lookup endpoint until
 * the trace is queryable. Defaults to a 15s deadline — Tempo's default
 * complete_block_timeout is 10s; our config drops it to 1s so first-query
 * latency is typically 1-2s.
 */
export async function pollTempoTrace(
  traceId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<TempoTraceResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  await fetch(`${TEMPO_QUERY_URL}/flush`, { method: "POST" });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${TEMPO_QUERY_URL}/api/v2/traces/${traceId}`);
    if (response.ok) {
      const body: unknown = await response.json();
      const result = parseTempoTrace(body);
      if (result.spans.length > 0) return result;
    }
    await Bun.sleep(pollIntervalMs);
  }
  throw new Error(
    `tempo: trace ${traceId} did not become queryable within ${String(timeoutMs)}ms`,
  );
}

export type TempoAttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];
export type TempoSpanAttributes = Record<string, TempoAttributeValue>;

export type TempoTraceSpan = {
  name: string;
  attributes: TempoSpanAttributes;
};

export type TempoTraceResult = {
  raw: unknown;
  spans: TempoTraceSpan[];
};

function parseTempoTrace(body: unknown): TempoTraceResult {
  const spans: TempoTraceSpan[] = [];
  if (typeof body !== "object" || body === null) return { raw: body, spans };
  const trace = (body as Record<string, unknown>)["trace"];
  if (typeof trace !== "object" || trace === null) {
    return { raw: body, spans };
  }
  const resourceSpansRaw = (trace as Record<string, unknown>)["resourceSpans"];
  if (!Array.isArray(resourceSpansRaw)) return { raw: body, spans };

  for (const rs of resourceSpansRaw) {
    if (typeof rs !== "object" || rs === null) continue;
    const scopeSpansRaw = (rs as Record<string, unknown>)["scopeSpans"];
    if (!Array.isArray(scopeSpansRaw)) continue;
    for (const ss of scopeSpansRaw) {
      if (typeof ss !== "object" || ss === null) continue;
      const spanList = (ss as Record<string, unknown>)["spans"];
      if (!Array.isArray(spanList)) continue;
      for (const s of spanList) {
        if (typeof s !== "object" || s === null) continue;
        const rec = s as Record<string, unknown>;
        const name = typeof rec["name"] === "string" ? rec["name"] : "";
        const attrs = parseAttributes(rec["attributes"]);
        spans.push({ name, attributes: attrs });
      }
    }
  }
  return { raw: body, spans };
}

function parseAttributes(value: unknown): TempoSpanAttributes {
  const result: TempoSpanAttributes = {};
  if (!Array.isArray(value)) return result;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    const key = rec["key"];
    if (typeof key !== "string") continue;
    const v = rec["value"];
    if (typeof v !== "object" || v === null) continue;
    const variant = v as Record<string, unknown>;
    if (typeof variant["stringValue"] === "string") {
      result[key] = variant["stringValue"];
      continue;
    }
    if (typeof variant["intValue"] === "string") {
      result[key] = Number.parseInt(variant["intValue"], 10);
      continue;
    }
    if (typeof variant["intValue"] === "number") {
      result[key] = variant["intValue"];
      continue;
    }
    if (typeof variant["doubleValue"] === "number") {
      result[key] = variant["doubleValue"];
      continue;
    }
    if (typeof variant["boolValue"] === "boolean") {
      result[key] = variant["boolValue"];
      continue;
    }
    const arrayValue = variant["arrayValue"];
    if (typeof arrayValue === "object" && arrayValue !== null) {
      const values = (arrayValue as Record<string, unknown>)["values"];
      if (Array.isArray(values)) {
        const parsed = parseArrayValues(values);
        if (parsed !== undefined) result[key] = parsed;
      }
    }
  }
  return result;
}

function parseArrayValues(values: unknown[]): TempoAttributeValue | undefined {
  const strings: string[] = [];
  const numbers: number[] = [];
  const bools: boolean[] = [];
  for (const entry of values) {
    if (typeof entry !== "object" || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec["stringValue"] === "string") {
      strings.push(rec["stringValue"]);
      continue;
    }
    if (typeof rec["intValue"] === "string") {
      numbers.push(Number.parseInt(rec["intValue"], 10));
      continue;
    }
    if (typeof rec["intValue"] === "number") {
      numbers.push(rec["intValue"]);
      continue;
    }
    if (typeof rec["doubleValue"] === "number") {
      numbers.push(rec["doubleValue"]);
      continue;
    }
    if (typeof rec["boolValue"] === "boolean") {
      bools.push(rec["boolValue"]);
      continue;
    }
  }
  if (strings.length > 0) return strings;
  if (numbers.length > 0) return numbers;
  if (bools.length > 0) return bools;
  return undefined;
}

/**
 * Fetch an object from MinIO using a raw SigV4 GET. Avoids pulling
 * @aws-sdk/client-s3 as a heavy dep just for tests.
 */
export async function getMinioObject(
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const { signedFetch } = await import("./signed-fetch.ts");
  const url = `${MINIO_ENDPOINT}/${bucket}/${key
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
  const response = await signedFetch({
    url,
    method: "GET",
    accessKeyId: e2eArchiveConfig.accessKeyId,
    secretAccessKey: e2eArchiveConfig.secretAccessKey,
    region: e2eArchiveConfig.region,
  });
  if (!response.ok) {
    throw new Error(
      `minio GET ${key} failed: ${String(response.status)} ${await response.text()}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function gunzipJson(bytes: Uint8Array): unknown {
  const text = gunzipSync(bytes).toString("utf8");
  return JSON.parse(text);
}
