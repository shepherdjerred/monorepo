import {
  context,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { OpenTelemetry, type OpenTelemetryOptions } from "@ai-sdk/otel";
import { modelIdForOpenRouterRoute } from "@shepherdjerred/llm-models";
import { activeLlmSubjectAttributes } from "./subject.ts";
import { z } from "zod";

type StartEvent = Parameters<OpenTelemetry["onStart"]>[0];
type EndEvent = Parameters<OpenTelemetry["onEnd"]>[0];
type AbortEvent = Parameters<OpenTelemetry["onAbort"]>[0];

const TelemetryErrorSchema = z
  .object({ callId: z.string(), error: z.unknown() })
  .loose();
const ErrorNameSchema = z.object({ name: z.string() }).loose();

type ParentState = {
  context: Context;
  span: Span;
};

export type RepositoryOpenTelemetryOptions = OpenTelemetryOptions & {
  service: string;
};

function operationName(operationId: string): "chat" | "embeddings" {
  return operationId === "ai.embed" || operationId === "ai.embedMany"
    ? "embeddings"
    : "chat";
}

/**
 * AI SDK OpenTelemetry integration with one repository-owned GenAI parent per
 * logical operation. The stock AI SDK operation, step, model, and tool spans
 * are created beneath this parent and retain their full telemetry contract.
 */
export class RepositoryOpenTelemetry extends OpenTelemetry {
  readonly #service: string;
  readonly #tracer: Tracer;
  readonly #parents = new Map<string, ParentState>();

  constructor(options: RepositoryOpenTelemetryOptions) {
    // The base class creates its own inference/tool/embed spans internally
    // (this.tracer.startSpan(...) inside its own onStart/onEnd handlers) and
    // that is where gen_ai.usage.* actually lands -- not on the repository-owned
    // gen_ai.<operation> parent span created below. Wrapping the caller's
    // enrichSpan is the base class's own extension point for exactly this: it
    // runs on every span type the base class creates, so composing onto it is
    // what gets the subject onto the same span as the usage, rather than only
    // onto the parent that wraps it.
    const callerEnrichSpan = options.enrichSpan;
    super({
      ...options,
      enrichSpan: (input) => ({
        ...callerEnrichSpan?.(input),
        ...activeLlmSubjectAttributes(),
      }),
    });
    this.#service = options.service;
    this.#tracer =
      options.tracer ??
      trace.getTracer("@shepherdjerred/llm-observability/ai-sdk");
  }

  override onStart(event: StartEvent): void {
    const operation = operationName(event.operationId);
    const workload = event.functionId;
    if (workload === undefined || workload.trim() === "") {
      throw new Error("AI SDK telemetry requires a functionId workload");
    }
    const model = modelIdForOpenRouterRoute(event.modelId) ?? event.modelId;
    const span = this.#tracer.startSpan(`gen_ai.${operation}`, {
      attributes: {
        "gen_ai.system": "openrouter",
        "gen_ai.provider.name": "openrouter",
        "gen_ai.operation.name": operation,
        "gen_ai.request.model": model,
        "llm.service": this.#service,
        "llm.call_site": workload,
        // Also stamped on this repository-owned wrapper span, for queries that
        // key on span name rather than gen_ai.usage.*. The span that actually
        // carries usage is one of the base class's own inference/tool/embed
        // spans, stamped via the enrichSpan composition in the constructor.
        ...activeLlmSubjectAttributes(),
      },
    });
    const parentContext = trace.setSpan(context.active(), span);
    this.#parents.set(event.callId, { context: parentContext, span });
    try {
      context.with(parentContext, () => {
        super.onStart(event);
      });
    } catch (error: unknown) {
      this.finishError(event.callId, error);
      throw error;
    }
  }

  override onEnd(event: EndEvent): void {
    try {
      this.inParentContext(event.callId, () => {
        super.onEnd(event);
      });
    } finally {
      this.finishSuccess(event.callId);
    }
  }

  override onAbort(event: AbortEvent): void {
    try {
      this.inParentContext(event.callId, () => {
        super.onAbort(event);
      });
    } finally {
      this.finishError(event.callId, new Error("AI SDK operation aborted"));
    }
  }

  override onError(value: unknown): void {
    const parsed = TelemetryErrorSchema.safeParse(value);
    if (!parsed.success) {
      super.onError(value);
      return;
    }
    try {
      this.inParentContext(parsed.data.callId, () => {
        super.onError(value);
      });
    } finally {
      this.finishError(parsed.data.callId, parsed.data.error);
    }
  }

  private inParentContext(callId: string, fn: () => void): void {
    const state = this.#parents.get(callId);
    if (state === undefined) {
      fn();
      return;
    }
    context.with(state.context, fn);
  }

  private finishSuccess(callId: string): void {
    const state = this.#parents.get(callId);
    if (state === undefined) return;
    this.#parents.delete(callId);
    state.span.setStatus({ code: SpanStatusCode.OK });
    state.span.end();
  }

  private finishError(callId: string, error: unknown): void {
    const state = this.#parents.get(callId);
    if (state === undefined) return;
    this.#parents.delete(callId);
    const parsedError = ErrorNameSchema.safeParse(error);
    state.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: parsedError.success ? parsedError.data.name : typeof error,
    });
    state.span.end();
  }
}
