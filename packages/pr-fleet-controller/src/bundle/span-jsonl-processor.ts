import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import {
  SynchronousEventFile,
  writeFileSinkSynchronously,
} from "#runtime/synchronous-file-sink.ts";

const PRIVATE_FILE_MODE = 0o600;

const SpanLineSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("span"),
  span: z.object({
    traceId: z.string().regex(/^[0-9a-f]{32}$/),
    spanId: z.string().regex(/^[0-9a-f]{16}$/),
    parentSpanId: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional(),
    name: z.string(),
    startTime: z.tuple([z.number(), z.number()]),
    duration: z.tuple([z.number(), z.number()]),
    status: z.object({ code: z.number(), message: z.string().optional() }),
    attributes: z.record(z.string(), z.unknown()),
    events: z.array(
      z.object({
        name: z.string(),
        time: z.tuple([z.number(), z.number()]),
        attributes: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  }),
});

export type SpanJsonlRedactor = (value: unknown) => unknown;

export class SpanJsonlProcessor implements SpanProcessor {
  readonly #file: SynchronousEventFile;
  readonly #redact: SpanJsonlRedactor;
  #closed = false;
  #failure: Error | undefined;

  constructor(path: string, redact: SpanJsonlRedactor) {
    this.#file = new SynchronousEventFile(path, PRIVATE_FILE_MODE);
    this.#redact = redact;
  }

  onStart(_span: Span, _parentContext: Context): void {
    // A completed span is the atomic persistence unit.
  }

  onEnd(span: ReadableSpan): void {
    if (this.#closed) {
      this.#rememberFailure(new Error("Cannot write a span after shutdown"));
      return;
    }
    try {
      const context = span.spanContext();
      const redacted = this.#redact({
        schemaVersion: 1,
        kind: "span",
        span: {
          traceId: context.traceId,
          spanId: context.spanId,
          ...(span.parentSpanContext === undefined
            ? {}
            : { parentSpanId: span.parentSpanContext.spanId }),
          name: span.name,
          startTime: span.startTime,
          duration: span.duration,
          status: span.status,
          attributes: span.attributes,
          events: span.events.map((event) => ({
            name: event.name,
            time: event.time,
            ...(event.attributes === undefined
              ? {}
              : { attributes: event.attributes }),
          })),
        },
      });
      const line = SpanLineSchema.parse(redacted);
      this.#file.write(
        `${JSON.stringify(line)}\n`,
        "span",
        writeFileSinkSynchronously,
      );
    } catch (error: unknown) {
      this.#rememberFailure(error);
    }
  }

  forceFlush(): Promise<void> {
    try {
      this.#throwFailure();
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async shutdown(): Promise<void> {
    if (this.#closed) {
      this.#throwFailure();
      return;
    }
    let flushFailure: Error | undefined;
    try {
      await this.forceFlush();
    } catch (error: unknown) {
      flushFailure = error instanceof Error ? error : new Error(String(error));
    }
    this.#closed = true;
    try {
      this.#file.close();
    } catch (error: unknown) {
      const closeFailure =
        error instanceof Error ? error : new Error(String(error));
      if (flushFailure !== undefined) {
        throw new AggregateError(
          [flushFailure, closeFailure],
          "Failed to flush and close spans.jsonl",
          { cause: error },
        );
      }
      throw closeFailure;
    }
    if (flushFailure !== undefined) {
      throw new Error("Failed to flush spans.jsonl", {
        cause: flushFailure,
      });
    }
  }

  #rememberFailure(error: unknown): void {
    this.#failure ??= error instanceof Error ? error : new Error(String(error));
  }

  #throwFailure(): void {
    if (this.#failure !== undefined) {
      throw new Error("Authoritative spans.jsonl persistence failed", {
        cause: this.#failure,
      });
    }
  }
}
