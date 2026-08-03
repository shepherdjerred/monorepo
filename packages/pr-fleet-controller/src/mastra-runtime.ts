import { Mastra } from "@mastra/core/mastra";
import type {
  AnySpan,
  ObservabilityExporter,
  SpanOutputProcessor,
} from "@mastra/core/observability";
import { MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore } from "@mastra/libsql";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import type { RunRecorder } from "./run-recorder.ts";

export type FleetMastraRuntime = {
  mastra: Mastra;
  shutdown: () => Promise<void>;
};

// The exporter list is intentionally centralized. A future opt-in remote
// exporter can be added here without changing the collection schema or the
// default local-only behavior.
export function createObservabilityExporters(): ObservabilityExporter[] {
  return [new MastraStorageExporter()];
}

function redactStringsInPlace(
  value: unknown,
  recorder: RunRecorder,
  seen = new WeakSet<object>(),
): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === "string") {
      Reflect.set(value, key, recorder.redact(inner));
    } else {
      redactStringsInPlace(inner, recorder, seen);
    }
  }
}

class RepositorySecretFilter implements SpanOutputProcessor {
  readonly name = "pr-fleet-repository-secret-filter";
  readonly #recorder: RunRecorder;

  constructor(recorder: RunRecorder) {
    this.#recorder = recorder;
  }

  process(span?: AnySpan): AnySpan | undefined {
    if (span === undefined) {
      return undefined;
    }
    for (const field of [
      span.attributes,
      span.metadata,
      span.input,
      span.output,
      span.errorInfo,
    ]) {
      redactStringsInPlace(field, this.#recorder);
    }
    if (typeof span.input === "string") {
      span.input = this.#recorder.redact(span.input);
    }
    if (typeof span.output === "string") {
      span.output = this.#recorder.redact(span.output);
    }
    return span;
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export async function createFleetMastraRuntime(
  recorder: RunRecorder,
): Promise<FleetMastraRuntime> {
  const libsql = new LibSQLStore({
    id: `${recorder.runId}-libsql`,
    url: `file:${recorder.paths.mastra}`,
  });
  const duckdb = new DuckDBStore({
    id: `${recorder.runId}-duckdb`,
    path: recorder.paths.observability,
    memoryLimit: "512MB",
    threads: 2,
  });
  const storage = new MastraCompositeStore({
    id: `${recorder.runId}-storage`,
    default: libsql,
    domains: { observability: duckdb.observability },
  });
  const observability = new Observability({
    configs: {
      default: {
        serviceName: "pr-fleet-controller",
        exporters: createObservabilityExporters(),
        spanOutputProcessors: [new RepositorySecretFilter(recorder)],
      },
    },
    // Mastra's structural filter runs after the repository literal-value filter.
    sensitiveDataFilter: true,
  });
  const mastra = new Mastra({
    storage,
    observability,
    environment: "local",
  });
  try {
    await storage.init();
    await recorder.secureRunArtifacts();
  } catch (error) {
    await mastra.shutdown();
    throw error;
  }

  let closed = false;
  return {
    mastra,
    shutdown: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await mastra.shutdown();
      await recorder.secureRunArtifacts();
    },
  };
}
