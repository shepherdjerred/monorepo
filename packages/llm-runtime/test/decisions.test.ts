import { AsyncLocalStorage } from "node:async_hooks";
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
  type Attributes,
  type AttributeValue,
  type Context,
  type ContextManager,
  type Exception,
  type HrTime,
  type Link,
  type Span,
  type SpanContext,
  type SpanOptions,
  type SpanStatus,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
  type TimeInput,
  type Tracer,
  type TracerProvider,
} from "@opentelemetry/api";
import {
  LlmArchiveSpanProcessor,
  type ArchiveConfig,
  type LlmArchiveSpanProcessorOptions,
} from "@shepherdjerred/llm-observability";
import { resetOtelGlobals } from "@shepherdjerred/llm-observability/otel-globals";
import { withLlmSubjectSpan } from "@shepherdjerred/llm-observability/subject";
import {
  createLlmRuntime,
  DecisionApiError,
  DecisionRequestSchema,
  type DecisionRequest,
  type LlmRuntimeLogRecord,
} from "@shepherdjerred/llm-runtime";
import { Registry } from "prom-client";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";

type ArchiveSpan = Parameters<LlmArchiveSpanProcessor["onEnd"]>[0];
type ArchiveInnerProcessor = LlmArchiveSpanProcessorOptions["inner"];
type ArchiveUploader = NonNullable<LlmArchiveSpanProcessorOptions["uploader"]>;

class TestContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>();

  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(ctx, () => fn.apply(thisArg, args));
  }

  bind<T>(_ctx: Context, target: T): T {
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this.storage.disable();
    return this;
  }
}

const testTraceParentPropagator: TextMapPropagator = {
  inject(ctx: Context, carrier: unknown, setter: TextMapSetter): void {
    const active = trace.getSpan(ctx);
    if (active === undefined) return;
    const sc = active.spanContext();
    setter.set(carrier, "traceparent", `00-${sc.traceId}-${sc.spanId}-01`);
  },
  extract(ctx: Context, _carrier: unknown, _getter: TextMapGetter): Context {
    return ctx;
  },
  fields(): string[] {
    return ["traceparent"];
  },
};

function hexId(num: number, width: number): string {
  return num.toString(16).padStart(width, "0");
}

class TestSpan implements Span {
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: HrTime = [1_700_000_000, 0];
  endTime: HrTime = [1_700_000_000, 5_000_000];
  status: SpanStatus = { code: SpanStatusCode.UNSET };
  readonly attributes: Record<string, AttributeValue | undefined> = {};
  readonly links: Link[] = [];
  readonly events: ArchiveSpan["events"] = [];
  readonly duration: HrTime = [0, 5_000_000];
  ended = false;
  readonly resource: ArchiveSpan["resource"];
  readonly instrumentationScope = {
    name: "@shepherdjerred/llm-observability",
    version: "0.1.0",
  };
  readonly droppedAttributesCount = 0;
  readonly droppedEventsCount = 0;
  readonly droppedLinksCount = 0;
  readonly parentSpanContext?: SpanContext;

  private readonly sc: SpanContext;
  private readonly onEndCallback: (span: ArchiveSpan) => void;

  constructor(options: {
    name: string;
    kind: SpanKind;
    spanContext: SpanContext;
    parentSpanContext: SpanContext | undefined;
    initialAttributes: Attributes | undefined;
    serviceName: string;
    onEnd: (span: ArchiveSpan) => void;
  }) {
    this.name = options.name;
    this.kind = options.kind;
    this.sc = options.spanContext;
    if (options.parentSpanContext !== undefined) {
      this.parentSpanContext = options.parentSpanContext;
    }
    if (options.initialAttributes !== undefined) {
      this.setAttributes(options.initialAttributes);
    }
    this.resource = {
      attributes: { "service.name": options.serviceName },
      merge: () => this.resource,
      getRawAttributes: () => [["service.name", options.serviceName]],
    };
    this.onEndCallback = options.onEnd;
  }

  spanContext(): SpanContext {
    return this.sc;
  }

  setAttribute(key: string, value: AttributeValue): this {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: Attributes): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        this.attributes[key] = value;
      }
    }
    return this;
  }

  addEvent(
    name: string,
    attributesOrStartTime?: Attributes | TimeInput,
    _startTime?: TimeInput,
  ): this {
    const attrs =
      typeof attributesOrStartTime === "object" &&
      !Array.isArray(attributesOrStartTime) &&
      !(attributesOrStartTime instanceof Date)
        ? attributesOrStartTime
        : {};
    this.events.push({
      name,
      attributes: attrs,
      time: [1_700_000_000, 1_000_000],
      droppedAttributesCount: 0,
    });
    return this;
  }

  addLink(link: Link): this {
    this.links.push(link);
    return this;
  }

  addLinks(links: Link[]): this {
    this.links.push(...links);
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.status = status;
    return this;
  }

  updateName(_name: string): this {
    return this;
  }

  end(_endTime?: TimeInput): void {
    if (this.ended) return;
    this.ended = true;
    this.onEndCallback(this.toArchiveSpan());
  }

  isRecording(): boolean {
    return !this.ended;
  }

  recordException(exception: Exception, _time?: TimeInput): void {
    const message =
      typeof exception === "string"
        ? exception
        : (exception.message ?? exception.name ?? "exception");
    this.addEvent("exception", { "exception.message": message });
  }

  private toArchiveSpan(): ArchiveSpan {
    const base = {
      name: this.name,
      kind: this.kind,
      spanContext: () => this.sc,
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.status,
      attributes: { ...this.attributes },
      links: this.links,
      events: this.events,
      duration: this.duration,
      ended: this.ended,
      resource: this.resource,
      instrumentationScope: this.instrumentationScope,
      droppedAttributesCount: this.droppedAttributesCount,
      droppedEventsCount: this.droppedEventsCount,
      droppedLinksCount: this.droppedLinksCount,
    };
    return this.parentSpanContext === undefined
      ? base
      : { ...base, parentSpanContext: this.parentSpanContext };
  }
}

class TestTracer implements Tracer {
  private nextTraceSeq = 1;
  private nextSpanSeq = 1;
  private readonly serviceName: string;
  private readonly onEnd: (ended: ArchiveSpan) => void;

  constructor(options: {
    serviceName: string;
    onEnd: (ended: ArchiveSpan) => void;
  }) {
    this.serviceName = options.serviceName;
    this.onEnd = options.onEnd;
  }

  startSpan(name: string, options?: SpanOptions, ctx?: Context): Span {
    const parentCtx = ctx ?? context.active();
    const parentSpan =
      options?.root === true ? undefined : trace.getSpan(parentCtx);
    const parentSc = parentSpan?.spanContext();
    const traceId = parentSc?.traceId ?? hexId(this.nextTraceSeq++, 32);
    const spanId = hexId(this.nextSpanSeq++, 16);
    return new TestSpan({
      name,
      kind: options?.kind ?? SpanKind.INTERNAL,
      spanContext: {
        traceId,
        spanId,
        traceFlags: TraceFlags.SAMPLED,
      },
      parentSpanContext: parentSc,
      initialAttributes: options?.attributes,
      serviceName: this.serviceName,
      onEnd: this.onEnd,
    });
  }

  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    ctx: Context,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan(
    name: string,
    optionsOrFn: SpanOptions | ((span: Span) => unknown),
    ctxOrFn?: Context | ((span: Span) => unknown),
    maybeFn?: (span: Span) => unknown,
  ): unknown {
    let options: SpanOptions | undefined;
    let parentCtx = context.active();
    let fn: ((span: Span) => unknown) | undefined;
    if (typeof optionsOrFn === "function") {
      fn = optionsOrFn;
    } else if (typeof ctxOrFn === "function") {
      options = optionsOrFn;
      fn = ctxOrFn;
    } else {
      options = optionsOrFn;
      if (ctxOrFn !== undefined) parentCtx = ctxOrFn;
      fn = maybeFn;
    }
    if (fn === undefined) {
      throw new Error("startActiveSpan requires a callback");
    }
    const span = this.startSpan(name, options, parentCtx);
    const nextCtx = trace.setSpan(parentCtx, span);
    return context.with(nextCtx, () => fn(span));
  }
}

function installTestTelemetry(serviceName: string): {
  endedSpans: ArchiveSpan[];
  uploads: { key: string; payload: string }[];
  flush: () => Promise<void>;
} {
  const endedSpans: ArchiveSpan[] = [];
  const uploads: { key: string; payload: string }[] = [];

  const collector: ArchiveInnerProcessor = {
    onStart() {
      // no-op
    },
    onEnd(span) {
      endedSpans.push(span);
    },
    async shutdown() {
      await Promise.resolve();
    },
    async forceFlush() {
      await Promise.resolve();
    },
  };

  const archiveConfig: ArchiveConfig = {
    bucket: "llm-archive",
    prefix: "llm",
    region: "us-east-1",
    endpoint: "http://seaweedfs.local:8333",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    sessionToken: undefined,
    forcePathStyle: true,
  };

  const uploader: ArchiveUploader = (config, key, payload) => {
    uploads.push({ key, payload });
    const bytes = Buffer.byteLength(payload, "utf8");
    return Promise.resolve({
      bucket: config.bucket,
      key,
      sha256: "deadbeef",
      bytesCompressed: bytes,
      bytesUncompressed: bytes,
      status: "ok",
      error: undefined,
    });
  };

  const archiveProcessor = new LlmArchiveSpanProcessor({
    inner: collector,
    archive: archiveConfig,
    uploader,
  });

  const tracer = new TestTracer({
    serviceName,
    onEnd: (ended) => archiveProcessor.onEnd(ended),
  });

  const provider: TracerProvider = {
    getTracer: () => tracer,
  };

  context.setGlobalContextManager(new TestContextManager().enable());
  propagation.setGlobalPropagator(testTraceParentPropagator);
  trace.setGlobalTracerProvider(provider);

  return {
    endedSpans,
    uploads,
    flush: () => archiveProcessor.forceFlush(),
  };
}

afterEach(() => {
  resetOtelGlobals();
});

const WirePayloadCheckSchema = z
  .object({
    model: z.string(),
    system: z.unknown().optional(),
    input: z.unknown(),
    questions: z.array(z.unknown()),
    prompt_cache_key: z.string().optional(),
    prompt_cache_options: z
      .object({
        mode: z.string().optional(),
        ttl: z.string().optional(),
      })
      .optional(),
    safety_identifier: z.string().optional(),
  })
  .strict();

function fullFixtureResponse(): Response {
  return Response.json(
    {
      id: "dec_123",
      model: "gpt-6-luna-2026-10-01",
      answers: [
        { type: "predicate", name: "should_reply", probability: 0.87 },
        {
          type: "choice",
          name: "route",
          choice: "direct_answer",
          confidence: 0.91,
          probabilities: [
            { value: "direct_answer", probability: 0.91 },
            { value: false, probability: 0.09 },
          ],
        },
        {
          type: "score",
          name: "quality",
          score: 0.75,
          confidence: 0.82,
          probabilities: [
            { label: "poor", value: 0, probability: 0.05 },
            { label: "good", value: 0.5, probability: 0.4 },
            { label: "great", value: 1, probability: 0.55 },
          ],
        },
        { type: "refusal", name: null },
      ],
      usage: {
        input_tokens: 1_000_000,
        input_tokens_details: {
          cached_tokens: 200_000,
          cache_write_tokens: 100_000,
        },
        output_tokens: 50_000,
        output_tokens_details: { reasoning_tokens: 40_000 },
        total_tokens: 1_050_000,
      },
    },
    {
      status: 200,
      headers: { "x-request-id": "req_header_abc" },
    },
  );
}

describe("runtime.decide answers and wire contract", () => {
  test("parses predicate, choice, score, and refusal answers and resolves answerByName", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenRawBody = "";

    const runtime = createLlmRuntime({
      credentials: { openai: { apiKey: "sk-decisions-fixture" } },
      service: "decisions-test",
      appName: "Decisions Test",
      fetch: (input, init) => {
        seenUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const headers = new Headers(init?.headers);
        seenHeaders = Object.fromEntries(headers.entries());
        if (typeof init?.body === "string") seenRawBody = init.body;
        return Promise.resolve(fullFixtureResponse());
      },
    });

    const request: DecisionRequest = {
      model: "gpt-6-luna",
      workload: "birmel.routing.decision",
      system: [
        {
          type: "input_text",
          text: "Evaluate the incoming Discord turn.",
          prompt_cache_breakpoint: true,
        },
      ],
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Can you check the build?" },
            {
              type: "input_json",
              data: { channel: "ops", mentionsBot: true },
              prompt_cache_breakpoint: true,
            },
            {
              type: "input_image",
              image_url: "https://example.com/screen.png",
              detail: "low",
            },
          ],
        },
      ],
      questions: [
        {
          type: "predicate",
          name: "should_reply",
          instructions: "Should the assistant respond in channel?",
        },
        {
          type: "choice",
          name: "route",
          instructions: [
            { type: "input_text", text: "Pick the execution path." },
          ],
          choices: [
            { value: "direct_answer", description: "Reply immediately" },
            { value: false, description: "Skip action" },
          ],
        },
        {
          type: "score",
          name: "quality",
          instructions: "Score clarity of the user request.",
          levels: [
            { label: "poor", description: "Ambiguous" },
            { label: "good" },
            { label: "great", description: "Actionable" },
          ],
        },
        { type: "predicate", instructions: "Unnamed auxiliary check." },
      ],
      promptCacheKey: "birmel:routing:v1",
      promptCacheOptions: { mode: "explicit", ttl: "30m" },
      safetyIdentifier: "guild_42",
    };

    const result = await runtime.decide(request);

    expect(seenUrl).toBe("https://api.openai.com/v1/decisions");
    expect(seenHeaders["authorization"]).toBe("Bearer sk-decisions-fixture");
    expect(seenHeaders["content-type"]).toBe("application/json");

    const parsedWireBody = WirePayloadCheckSchema.parse(
      JSON.parse(seenRawBody),
    );
    expect(parsedWireBody.model).toBe("gpt-6-luna");
    expect(parsedWireBody.prompt_cache_key).toBe("birmel:routing:v1");
    expect(parsedWireBody.prompt_cache_options).toEqual({
      mode: "explicit",
      ttl: "30m",
    });
    expect(parsedWireBody.safety_identifier).toBe("guild_42");
    expect(seenRawBody).not.toContain("birmel.routing.decision");

    expect(result.model).toBe("gpt-6-luna-2026-10-01");
    expect(result.answers).toHaveLength(4);
    expect(result.answerByName("should_reply")).toEqual({
      type: "predicate",
      name: "should_reply",
      probability: 0.87,
    });
    expect(result.answerByName("route")).toEqual({
      type: "choice",
      name: "route",
      choice: "direct_answer",
      confidence: 0.91,
      probabilities: [
        { value: "direct_answer", probability: 0.91 },
        { value: false, probability: 0.09 },
      ],
    });
    expect(result.answerByName("quality")).toEqual({
      type: "score",
      name: "quality",
      score: 0.75,
      confidence: 0.82,
      probabilities: [
        { label: "poor", value: 0, probability: 0.05 },
        { label: "good", value: 0.5, probability: 0.4 },
        { label: "great", value: 1, probability: 0.55 },
      ],
    });
    expect(result.answers[3]).toEqual({ type: "refusal", name: null });
    expect(result.answerByName("missing")).toBeUndefined();

    expect(result.usage).toEqual({
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      cacheWriteTokens: 100_000,
      outputTokens: 50_000,
      reasoningTokens: 40_000,
      totalTokens: 1_050_000,
    });
    expect(result.catalogCostUsd).toBeCloseTo(0.0845, 10);
  });
});

describe("runtime.decide metrics and structured logs", () => {
  test("records Prometheus counters, $0 output cost, and body-free structured logs", async () => {
    const register = new Registry();
    const logs: LlmRuntimeLogRecord[] = [];
    const runtime = createLlmRuntime({
      credentials: { openai: { apiKey: "sk-metrics-fixture" } },
      service: "scout-beta",
      appName: "Scout Beta",
      metricsRegister: register,
      logger: (record) => logs.push(record),
      fetch: () =>
        Promise.resolve(
          Response.json(
            {
              model: "gpt-6-luna",
              answers: [
                {
                  type: "predicate",
                  name: "interesting_match",
                  probability: 0.94,
                },
              ],
              usage: {
                input_tokens: 10_000,
                input_tokens_details: {
                  cached_tokens: 4000,
                  cache_write_tokens: 1000,
                },
                output_tokens: 25_000,
                output_tokens_details: {
                  reasoning_tokens: 20_000,
                },
                total_tokens: 35_000,
              },
            },
            {
              status: 200,
              headers: { "x-request-id": "req_scout_77" },
            },
          ),
        ),
    });

    const result = await runtime.decide({
      model: "gpt-6-luna",
      workload: "scout.match.gate",
      input: "SECRET_PROMPT_MARKER_DO_NOT_LOG",
      questions: [
        {
          type: "predicate",
          name: "interesting_match",
          instructions: "SECRET_QUESTION_MARKER_DO_NOT_LOG",
        },
      ],
    });

    expect(result.catalogCostUsd).toBeCloseTo(6.65e-4, 10);

    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'llm_requests_total{service="scout-beta",workload="scout.match.gate",provider="openai",model="gpt-6-luna",outcome="success"} 1',
    );
    expect(metricsText).toContain(
      'llm_tokens_total{service="scout-beta",workload="scout.match.gate",provider="openai",model="gpt-6-luna",type="input"} 5000',
    );
    expect(metricsText).toContain(
      'llm_tokens_total{service="scout-beta",workload="scout.match.gate",provider="openai",model="gpt-6-luna",type="cached_input"} 4000',
    );
    expect(metricsText).toContain(
      'llm_tokens_total{service="scout-beta",workload="scout.match.gate",provider="openai",model="gpt-6-luna",type="cache_write"} 1000',
    );
    expect(metricsText).toContain(
      'llm_tokens_total{service="scout-beta",workload="scout.match.gate",provider="openai",model="gpt-6-luna",type="output"} 25000',
    );
    expect(metricsText).toContain(
      'llm_tokens_total{service="scout-beta",workload="scout.match.gate",provider="openai",model="gpt-6-luna",type="reasoning"} 20000',
    );
    expect(metricsText).toContain("llm_cost_usd_total");
    expect(metricsText).toContain("llm_request_duration_seconds_count");

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "info",
      event: "llm.provider.response",
      service: "scout-beta",
      workload: "scout.match.gate",
      provider: "openai",
      model: "gpt-6-luna",
      resolvedModel: "gpt-6-luna",
      responseId: "req_scout_77",
      inputTokens: 5000,
      cachedInputTokens: 4000,
      cacheWriteTokens: 1000,
      outputTokens: 25_000,
      reasoningTokens: 20_000,
      totalTokens: 35_000,
      outcome: "success",
    });
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain("SECRET_PROMPT_MARKER_DO_NOT_LOG");
    expect(serializedLogs).not.toContain("SECRET_QUESTION_MARKER_DO_NOT_LOG");
    expect(serializedLogs).not.toContain("interesting_match");
  });
});

describe("runtime.decide OpenTelemetry and SeaweedFS archiving", () => {
  test("stamps OTel subject attributes, propagates W3C traceparent, and archives bodies via LlmArchiveSpanProcessor", async () => {
    const telemetry = installTestTelemetry("birmel");
    let outboundTraceparent: string | undefined;

    const runtime = createLlmRuntime({
      credentials: { openai: { apiKey: "sk-otel-fixture" } },
      service: "birmel",
      appName: "Birmel",
      fetch: (_input, init) => {
        const headers = new Headers(init?.headers);
        outboundTraceparent = headers.get("traceparent") ?? undefined;
        return Promise.resolve(
          Response.json(
            {
              model: "gpt-6-luna",
              answers: [
                {
                  type: "choice",
                  name: "moderation_gate",
                  choice: "allow",
                  confidence: 0.99,
                  probabilities: [
                    { value: "allow", probability: 0.99 },
                    { value: "escalate", probability: 0.01 },
                  ],
                },
              ],
              usage: {
                input_tokens: 200,
                input_tokens_details: {
                  cached_tokens: 50,
                  cache_write_tokens: 25,
                },
                output_tokens: 10,
                total_tokens: 210,
              },
            },
            {
              status: 200,
              headers: { "x-request-id": "req_archive_99" },
            },
          ),
        );
      },
    });

    await withLlmSubjectSpan(
      "birmel.message.handle",
      { kind: "discord_user", id: "user_987654" },
      async () => {
        await runtime.decide({
          model: "gpt-6-luna",
          workload: "birmel.moderation.gate",
          system: "Judge message safety carefully.",
          input: [
            {
              type: "input_json",
              data: [
                { author: "alice", text: "hello world" },
                { author: "bob", text: "all clear" },
              ],
            },
          ],
          questions: [
            {
              type: "choice",
              name: "moderation_gate",
              instructions: "Allow or escalate?",
              choices: [{ value: "allow" }, { value: "escalate" }],
            },
          ],
        });
      },
    );

    await telemetry.flush();

    expect(outboundTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    const llmSpan = telemetry.endedSpans.find((span) =>
      span.name.startsWith("gen_ai.chat"),
    );
    expect(llmSpan).toBeDefined();
    expect(llmSpan?.attributes).toMatchObject({
      "gen_ai.system": "openai",
      "gen_ai.provider.name": "openai",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "gpt-6-luna",
      "gen_ai.response.model": "gpt-6-luna",
      "gen_ai.response.id": "req_archive_99",
      "gen_ai.usage.input_tokens": 200,
      "gen_ai.usage.output_tokens": 10,
      "gen_ai.usage.cache_read_input_tokens": 50,
      "gen_ai.usage.cache_creation_input_tokens": 25,
      "llm.service": "birmel",
      "llm.call_site": "birmel.moderation.gate",
      "llm.subject.kind": "discord_user",
      "llm.subject.id": "user_987654",
      "llm.archive.status": "ok",
      "llm.archive.s3_bucket": "llm-archive",
    });

    expect(telemetry.uploads).toHaveLength(1);
    const archivedEnvelope = z
      .object({
        service: z.string(),
        provider: z.string(),
        callSite: z.string(),
        "gen_ai.system_instructions": z.string(),
        "gen_ai.input.messages": z.object({
          input: z.array(z.unknown()),
          questions: z.array(z.unknown()),
        }),
        "gen_ai.output.messages": z.array(
          z.object({
            type: z.literal("choice"),
            name: z.literal("moderation_gate"),
            choice: z.literal("allow"),
          }),
        ),
      })
      .loose()
      .parse(JSON.parse(telemetry.uploads[0]?.payload ?? "{}"));

    expect(archivedEnvelope.service).toBe("birmel");
    expect(archivedEnvelope.provider).toBe("openai");
    expect(archivedEnvelope.callSite).toBe("birmel.moderation.gate");
    expect(archivedEnvelope["gen_ai.system_instructions"]).toBe(
      "Judge message safety carefully.",
    );
    expect(archivedEnvelope["gen_ai.input.messages"].questions).toHaveLength(1);
    expect(archivedEnvelope["gen_ai.output.messages"]).toHaveLength(1);
  });
});

describe("runtime.decide validation and error handling", () => {
  test("rejects models without the decisions endpoint, missing credentials, and invalid question schemas", async () => {
    const runtime = createLlmRuntime({
      credentials: {
        openai: { apiKey: "sk-test" },
        anthropic: { kind: "apiKey", apiKey: "sk-ant-test" },
      },
      service: "decisions-validation",
      appName: "Decisions Validation",
      fetch: () => Promise.resolve(Response.json({})),
    });

    await expect(
      runtime.decide({
        model: "gpt-6.1-sol",
        workload: "test.invalid-model",
        input: "hello",
        questions: [{ type: "predicate", instructions: "ok?" }],
      }),
    ).rejects.toThrow("not decisions");

    await expect(
      runtime.decide({
        model: "claude-sonnet-5",
        workload: "test.invalid-provider",
        input: "hello",
        questions: [{ type: "predicate", instructions: "ok?" }],
      }),
    ).rejects.toThrow("not decisions");

    const unconfiguredRuntime = createLlmRuntime({
      credentials: {},
      service: "missing-openai",
      appName: "Missing OpenAI",
    });
    await expect(
      unconfiguredRuntime.decide({
        model: "gpt-6-luna",
        workload: "test.no-creds",
        input: "hello",
        questions: [{ type: "predicate", instructions: "ok?" }],
      }),
    ).rejects.toThrow("no OpenAI credentials were configured");

    expect(() =>
      DecisionRequestSchema.parse({
        model: "gpt-6-luna",
        workload: "test.dup",
        input: "hello",
        questions: [
          { type: "predicate", name: "same", instructions: "first" },
          { type: "predicate", name: "same", instructions: "second" },
        ],
      }),
    ).toThrow("unique");
  });

  test("records failure metrics/logs and throws sanitized DecisionApiError on HTTP, transport, parse, and abort failures", async () => {
    const register = new Registry();
    const logs: LlmRuntimeLogRecord[] = [];
    const secretKey = "sk-super-secret-decisions-key-123456";

    const httpRuntime = createLlmRuntime({
      credentials: { openai: { apiKey: secretKey } },
      service: "decisions-errors",
      appName: "Decisions Errors",
      metricsRegister: register,
      logger: (record) => logs.push(record),
      fetch: () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                message: `Invalid key ${secretKey} on /v1/decisions`,
              },
            },
            { status: 429 },
          ),
        ),
    });

    let caughtHttp: unknown;
    try {
      await httpRuntime.decide({
        model: "gpt-6-luna",
        workload: "test.http-fail",
        input: "hello",
        questions: [{ type: "predicate", instructions: "ok?" }],
      });
    } catch (error: unknown) {
      caughtHttp = error;
    }

    expect(caughtHttp).toBeInstanceOf(DecisionApiError);
    if (!(caughtHttp instanceof DecisionApiError)) {
      throw new Error("expected DecisionApiError");
    }
    expect(caughtHttp.kind).toBe("http");
    expect(caughtHttp.status).toBe(429);
    expect(caughtHttp.message).toContain("HTTP 429");
    expect(caughtHttp.message).not.toContain(secretKey);

    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'llm_requests_total{service="decisions-errors",workload="test.http-fail",provider="openai",model="gpt-6-luna",outcome="error"} 1',
    );
    expect(logs.at(-1)).toMatchObject({
      level: "error",
      event: "llm.provider.call_failed",
      workload: "test.http-fail",
      provider: "openai",
      model: "gpt-6-luna",
      outcome: "error",
      responseStatus: 429,
      errorType: "DecisionApiError",
    });

    const transportRuntime = createLlmRuntime({
      credentials: { openai: { apiKey: "sk-test" } },
      service: "decisions-errors",
      appName: "Decisions Errors",
      fetch: () => Promise.reject(new Error("socket hang up")),
    });
    await expect(
      transportRuntime.decide({
        model: "gpt-6-luna",
        workload: "test.transport-fail",
        input: "hello",
        questions: [{ type: "predicate", instructions: "ok?" }],
      }),
    ).rejects.toMatchObject({
      name: "DecisionApiError",
      kind: "transport",
    });

    const parseRuntime = createLlmRuntime({
      credentials: { openai: { apiKey: "sk-test" } },
      service: "decisions-errors",
      appName: "Decisions Errors",
      fetch: () =>
        Promise.resolve(Response.json({ model: "gpt-6-luna", answers: "bad" })),
    });
    await expect(
      parseRuntime.decide({
        model: "gpt-6-luna",
        workload: "test.parse-fail",
        input: "hello",
        questions: [{ type: "predicate", instructions: "ok?" }],
      }),
    ).rejects.toMatchObject({
      name: "DecisionApiError",
      kind: "parse",
    });

    const abortController = new AbortController();
    abortController.abort();
    const abortRuntime = createLlmRuntime({
      credentials: { openai: { apiKey: "sk-test" } },
      service: "decisions-errors",
      appName: "Decisions Errors",
      fetch: () => Promise.reject(new DOMException("Aborted", "AbortError")),
    });
    await expect(
      abortRuntime.decide({
        model: "gpt-6-luna",
        workload: "test.abort-fail",
        input: "hello",
        questions: [{ type: "predicate", instructions: "ok?" }],
        abortSignal: abortController.signal,
      }),
    ).rejects.toMatchObject({
      name: "DecisionApiError",
      kind: "aborted",
    });
  });
});
