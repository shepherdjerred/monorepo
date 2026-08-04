import type { FileSink } from "bun";
import { TracingEventType } from "@mastra/core/observability";
import type {
  MetricEvent,
  ObservabilityExporter,
  TracingEvent,
} from "@mastra/core/observability";

/**
 * Mirrors Mastra's model-reasoning spans and token/cost metrics to an
 * append-only `spans.jsonl` in the run bundle so the live dashboard can tail
 * them the same way it tails `events.jsonl`.
 *
 * This exists because the authoritative reasoning store — `observability.duckdb`
 * — is opened read-write and exclusively locked by the controller for the whole
 * run, so no second process can read it live. The DuckDB copy remains the
 * durable, verified source; this JSONL is a live-view convenience mirror only.
 *
 * Every write is **best-effort**: a failure here is caught and dropped, never
 * propagated, because a dashboard mirror must never abort a controller run. It
 * is therefore not hash-chained and not part of the run manifest. Spans arrive
 * already secret-scrubbed by the `RepositorySecretFilter` span processor, which
 * runs before exporters.
 *
 * Only completed spans are emitted (on `span_ended`), so each line carries the
 * span's full input/output/attributes; in-flight spans are omitted.
 */
export class SpanJsonlExporter implements ObservabilityExporter {
  readonly name = "pr-fleet-spans-jsonl";
  readonly #path: string;
  #sink: FileSink | undefined;
  #failed = false;

  constructor(spansPath: string) {
    this.#path = spansPath;
  }

  #writer(): FileSink | undefined {
    if (this.#failed) {
      return undefined;
    }
    if (this.#sink === undefined) {
      try {
        this.#sink = Bun.file(this.#path).writer();
      } catch {
        this.#failed = true;
        return undefined;
      }
    }
    return this.#sink;
  }

  async #drain(result: Promise<number>): Promise<void> {
    try {
      await result;
    } catch {
      this.#failed = true;
    }
  }

  // write()/flush() may return a Promise under backpressure. The mirror is
  // best-effort, so the result is not awaited inline, but a later async I/O
  // rejection (e.g. a full disk) must disable the mirror rather than surface as
  // an unhandled rejection that could take down the controller run.
  #settle(result: number | Promise<number>): void {
    if (result instanceof Promise) {
      void this.#drain(result);
    }
  }

  #append(line: Record<string, unknown>): void {
    const sink = this.#writer();
    if (sink === undefined) {
      return;
    }
    try {
      this.#settle(sink.write(`${JSON.stringify(line)}\n`));
      // Flush so a tailing dashboard sees spans promptly rather than waiting
      // for the buffer to fill.
      this.#settle(sink.flush());
    } catch {
      this.#failed = true;
    }
  }

  exportTracingEvent(event: TracingEvent): Promise<void> {
    if (event.type === TracingEventType.SPAN_ENDED) {
      this.#append({ kind: "span", span: event.exportedSpan });
    }
    return Promise.resolve();
  }

  onMetricEvent(event: MetricEvent): void {
    this.#append({ kind: "metric", metric: event.metric });
  }

  flush(): Promise<void> {
    const sink = this.#sink;
    if (sink !== undefined) {
      this.#settle(sink.flush());
    }
    return Promise.resolve();
  }

  async shutdown(): Promise<void> {
    const sink = this.#sink;
    this.#sink = undefined;
    if (sink !== undefined) {
      await sink.end();
    }
  }
}
