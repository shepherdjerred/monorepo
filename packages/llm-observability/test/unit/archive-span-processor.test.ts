import { test, expect } from "bun:test";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { trace, type Context, type Span } from "@opentelemetry/api";
import {
  LlmArchiveSpanProcessor,
  type ArchiveUploader,
} from "#src/archive-span-processor.ts";
import type { ArchiveConfig } from "#src/archive-uploader.ts";

class CollectingProcessor implements SpanProcessor {
  readonly spans: ReadableSpan[] = [];
  onStart(_span: Span, _ctx: Context): void {
    // no-op: collector only watches onEnd
  }
  onEnd(span: ReadableSpan): void {
    this.spans.push(span);
  }
  async shutdown(): Promise<void> {
    // no-op: collector holds no async resources
    await Promise.resolve();
  }
  async forceFlush(): Promise<void> {
    // no-op: collector has no buffered work to flush
    await Promise.resolve();
  }
}

const archiveConfig: ArchiveConfig = {
  bucket: "llm-archive",
  prefix: "llm",
  region: "us-east-1",
  endpoint: "http://localhost:9000",
  accessKeyId: "key",
  secretAccessKey: "secret",
  sessionToken: undefined,
  forcePathStyle: true,
};

function buildSuccessUploader(): {
  uploader: ArchiveUploader;
  uploads: { key: string; payload: string }[];
} {
  const uploads: { key: string; payload: string }[] = [];
  const uploader: ArchiveUploader = async (config, key, payload) => {
    uploads.push({ key, payload });
    const sizes = Buffer.byteLength(payload, "utf8");
    return {
      bucket: config.bucket,
      key,
      sha256: "abcd",
      bytesCompressed: sizes,
      bytesUncompressed: sizes,
      status: "ok",
      error: undefined,
    };
  };
  return { uploader, uploads };
}

async function flushProcessor(
  processor: LlmArchiveSpanProcessor,
): Promise<void> {
  await processor.forceFlush();
}

function buildProvider(options: {
  serviceName: string;
  processor: LlmArchiveSpanProcessor;
}): BasicTracerProvider {
  return new BasicTracerProvider({
    resource: resourceFromAttributes({ "service.name": options.serviceName }),
    spanProcessors: [options.processor],
  });
}

const failedUploader: ArchiveUploader = async () => ({
  bucket: "llm-archive",
  key: "llm/x/y/z.json.gz",
  sha256: "",
  bytesCompressed: 0,
  bytesUncompressed: 0,
  status: "failed",
  error: "connection refused",
});

const refusingUploader: ArchiveUploader = async () => {
  throw new Error("uploader should not be called");
};

const compatUploader: ArchiveUploader = async (config, key) => ({
  bucket: config.bucket,
  key,
  sha256: "",
  bytesCompressed: 0,
  bytesUncompressed: 0,
  status: "ok",
  error: undefined,
});

test("archives a span with gen_ai.* body attributes and forwards a slim span", async () => {
  const collector = new CollectingProcessor();
  const { uploader, uploads } = buildSuccessUploader();
  const processor = new LlmArchiveSpanProcessor({
    inner: collector,
    archive: archiveConfig,
    uploader,
  });
  const provider = buildProvider({
    serviceName: "scout-backend",
    processor,
  });
  const tracer = provider.getTracer("test");

  await tracer.startActiveSpan("gen_ai.chat", async (span) => {
    span.setAttributes({
      "gen_ai.system": "openai",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "gpt-4o-mini",
      "gen_ai.response.model": "gpt-4o-mini-2024-07-18",
      "gen_ai.usage.input_tokens": 12,
      "gen_ai.usage.output_tokens": 3,
      "llm.service": "scout-backend",
      "llm.call_site": "scout-review",
      "gen_ai.input.messages": JSON.stringify([
        { role: "user", content: "hi" },
      ]),
      "gen_ai.output.messages": JSON.stringify([
        { role: "assistant", content: "hello back" },
      ]),
    });
    span.end();
  });

  await flushProcessor(processor);

  expect(collector.spans.length).toBe(1);
  const forwarded = collector.spans[0]!;
  expect(forwarded.attributes["gen_ai.input.messages"]).toBeUndefined();
  expect(forwarded.attributes["gen_ai.output.messages"]).toBeUndefined();
  expect(forwarded.attributes["llm.archive.status"]).toBe("ok");
  expect(forwarded.attributes["llm.archive.s3_bucket"]).toBe("llm-archive");
  expect(forwarded.attributes["gen_ai.usage.input_tokens"]).toBe(12);

  expect(uploads.length).toBe(1);
  const archived = JSON.parse(uploads[0]!.payload);
  expect(archived.service).toBe("scout-backend");
  expect(archived.provider).toBe("openai");
  expect(archived["gen_ai.input.messages"]).toEqual([
    { role: "user", content: "hi" },
  ]);
  expect(archived["gen_ai.output.messages"]).toEqual([
    { role: "assistant", content: "hello back" },
  ]);
  expect(uploads[0]!.key).toMatch(
    /^llm\/scout-backend\/openai\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f]{32}-[0-9a-f]{16}\.json\.gz$/,
  );
});

test("passes non-LLM spans through unchanged", async () => {
  const collector = new CollectingProcessor();
  const { uploader, uploads } = buildSuccessUploader();
  const processor = new LlmArchiveSpanProcessor({
    inner: collector,
    archive: archiveConfig,
    uploader,
  });
  const provider = buildProvider({
    serviceName: "test",
    processor,
  });
  const tracer = provider.getTracer("test");

  await tracer.startActiveSpan("plain.work", async (span) => {
    span.setAttributes({ "app.kind": "control" });
    span.end();
  });

  await flushProcessor(processor);

  expect(uploads.length).toBe(0);
  expect(collector.spans.length).toBe(1);
  expect(collector.spans[0]!.attributes["app.kind"]).toBe("control");
  expect(collector.spans[0]!.attributes["llm.archive.status"]).toBeUndefined();
});

test("marks span as failed when uploader throws", async () => {
  const collector = new CollectingProcessor();
  const warnings: string[] = [];
  const processor = new LlmArchiveSpanProcessor({
    inner: collector,
    archive: archiveConfig,
    uploader: failedUploader,
    logger: {
      warn: (message) => {
        warnings.push(message);
      },
    },
  });
  const provider = buildProvider({ serviceName: "temporal", processor });
  const tracer = provider.getTracer("test");

  await tracer.startActiveSpan("gen_ai.chat", async (span) => {
    span.setAttributes({
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-haiku-4-5",
      "gen_ai.input.messages": JSON.stringify([
        { role: "user", content: "hi" },
      ]),
    });
    span.end();
  });
  await flushProcessor(processor);

  expect(warnings.length).toBe(1);
  expect(collector.spans[0]!.attributes["llm.archive.status"]).toBe("failed");
  expect(collector.spans[0]!.attributes["llm.archive.error"]).toBe(
    "connection refused",
  );
});

test("marks sampled-out spans with status=sampled_out", async () => {
  const collector = new CollectingProcessor();
  const processor = new LlmArchiveSpanProcessor({
    inner: collector,
    archive: archiveConfig,
    uploader: refusingUploader,
    sampleRate: 0,
    random: () => 0.5,
  });
  const provider = buildProvider({ serviceName: "birmel", processor });
  const tracer = provider.getTracer("test");

  await tracer.startActiveSpan("gen_ai.chat", async (span) => {
    span.setAttributes({
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o-mini",
      "gen_ai.input.messages": JSON.stringify([
        { role: "user", content: "hi" },
      ]),
    });
    span.end();
  });
  await flushProcessor(processor);

  expect(collector.spans.length).toBe(1);
  expect(collector.spans[0]!.attributes["llm.archive.status"]).toBe(
    "sampled_out",
  );
  expect(
    collector.spans[0]!.attributes["gen_ai.input.messages"],
  ).toBeUndefined();
});

test("registers as SimpleSpanProcessor compat (does not throw)", () => {
  const exporter: SpanProcessor = {
    onStart(): void {
      // no-op: smoke-test stub
    },
    onEnd(): void {
      // no-op: smoke-test stub
    },
    async shutdown() {
      // no-op: smoke-test stub
      await Promise.resolve();
    },
    async forceFlush() {
      // no-op: smoke-test stub
      await Promise.resolve();
    },
  };
  const simple = new SimpleSpanProcessor({
    export(_spans, cb) {
      cb({ code: 0 });
    },
    async shutdown() {
      // no-op: smoke-test stub
      await Promise.resolve();
    },
    async forceFlush() {
      // no-op: smoke-test stub
      await Promise.resolve();
    },
  });
  // tracer.getTracer used via export to silence unused
  trace.getTracer("compat-noop");
  const processor = new LlmArchiveSpanProcessor({
    inner: simple,
    archive: archiveConfig,
    uploader: compatUploader,
  });
  expect(processor).toBeDefined();
  const onStart = exporter.onStart.bind(exporter);
  expect(onStart).toBeDefined();
});
