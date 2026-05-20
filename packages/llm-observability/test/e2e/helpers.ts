import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { LlmArchiveSpanProcessor } from "#src/archive-span-processor.ts";
import { type ArchiveConfig } from "#src/archive-uploader.ts";

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

// Tempo's OTLP-encoded attribute value variants. Each entry is exactly one of:
// stringValue / intValue (string or number) / doubleValue / boolValue /
// arrayValue.values (array of the above scalar variants).
const ScalarAttributeValueSchema = z.object({
  stringValue: z.string().optional(),
  intValue: z.union([z.string(), z.number()]).optional(),
  doubleValue: z.number().optional(),
  boolValue: z.boolean().optional(),
});

const AttributeValueSchema = ScalarAttributeValueSchema.extend({
  arrayValue: z
    .object({
      values: z.array(ScalarAttributeValueSchema),
    })
    .optional(),
});

const AttributeEntrySchema = z.object({
  key: z.string(),
  value: AttributeValueSchema,
});

const TempoSpanSchema = z.object({
  name: z.string().optional(),
  attributes: z.array(z.unknown()).optional(),
});

const TempoTraceBodySchema = z.object({
  trace: z.object({
    resourceSpans: z.array(
      z.object({
        scopeSpans: z
          .array(
            z.object({
              spans: z.array(z.unknown()).optional(),
            }),
          )
          .optional(),
      }),
    ),
  }),
});

function parseTempoTrace(body: unknown): TempoTraceResult {
  const parsed = TempoTraceBodySchema.safeParse(body);
  if (!parsed.success) return { raw: body, spans: [] };

  const spans: TempoTraceSpan[] = [];
  for (const rs of parsed.data.trace.resourceSpans) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const rawSpan of ss.spans ?? []) {
        const spanParse = TempoSpanSchema.safeParse(rawSpan);
        if (!spanParse.success) continue;
        spans.push({
          name: spanParse.data.name ?? "",
          attributes: parseAttributes(spanParse.data.attributes ?? []),
        });
      }
    }
  }
  return { raw: body, spans };
}

function parseAttributes(rawEntries: unknown[]): TempoSpanAttributes {
  const result: TempoSpanAttributes = {};
  for (const entry of rawEntries) {
    const parsed = AttributeEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const scalar = scalarFromVariant(parsed.data.value);
    if (scalar !== undefined) {
      result[parsed.data.key] = scalar;
      continue;
    }
    const arrayValue = parsed.data.value.arrayValue;
    if (arrayValue !== undefined) {
      const arr = parseArrayValues(arrayValue.values);
      if (arr !== undefined) result[parsed.data.key] = arr;
    }
  }
  return result;
}

function scalarFromVariant(
  variant: z.infer<typeof ScalarAttributeValueSchema>,
): string | number | boolean | undefined {
  if (variant.stringValue !== undefined) return variant.stringValue;
  const intNumber = coerceIntValue(variant.intValue);
  if (intNumber !== undefined) return intNumber;
  if (variant.doubleValue !== undefined) return variant.doubleValue;
  if (variant.boolValue !== undefined) return variant.boolValue;
  return undefined;
}

function coerceIntValue(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? Number.parseInt(value, 10) : value;
}

function parseArrayValues(
  values: z.infer<typeof ScalarAttributeValueSchema>[],
): TempoAttributeValue | undefined {
  const strings: string[] = [];
  const numbers: number[] = [];
  const bools: boolean[] = [];
  for (const variant of values) {
    if (variant.stringValue !== undefined) {
      strings.push(variant.stringValue);
      continue;
    }
    const intNumber = coerceIntValue(variant.intValue);
    if (intNumber !== undefined) {
      numbers.push(intNumber);
      continue;
    }
    if (variant.doubleValue !== undefined) {
      numbers.push(variant.doubleValue);
      continue;
    }
    if (variant.boolValue !== undefined) {
      bools.push(variant.boolValue);
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
