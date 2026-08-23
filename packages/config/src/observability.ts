import type {
  ChangeEvent,
  ResolverHooks,
} from "@shepherdjerred/config/resolver.ts";
import type { ConfigSourceName } from "@shepherdjerred/config/source.ts";

/**
 * Instrumentation for the resolver.
 *
 * ## Why this package owns no metrics client
 *
 * A Prometheus registry is per-process state, so a library that creates one
 * forces every consumer onto its choice — and this package is explicitly meant
 * to stay light enough to hand to someone self-hosting a bot, who has neither
 * Prometheus nor OpenTelemetry.
 *
 * So the hooks are injected and each consumer wires its own counters. What is
 * shared here is the **naming**: metric names and label sets live in one place
 * so three services cannot instrument the same thing three different ways.
 */

/** Canonical metric names. Use these verbatim so dashboards work everywhere. */
export const CONFIG_METRICS = {
  resolutions: "config_resolutions_total",
  changes: "config_value_changed_total",
  errors: "config_resolution_errors_total",
  duration: "config_resolution_duration_seconds",
} as const;

/**
 * Label sets, fixed here for the same reason.
 *
 * `key` and `source` are safe labels: both come from the declared definition,
 * so cardinality is bounded by the config surface. **`targetingKey` is never a
 * label** — it is a guild or user id, so it would be unbounded.
 */
export const CONFIG_METRIC_LABELS = {
  resolutions: ["key", "source"],
  changes: ["key", "source"],
  errors: ["key", "stage"],
  duration: ["source"],
} as const;

/** Where a resolution failed, for the `stage` label. */
export type ResolutionErrorStage = "source" | "validate";

export type ResolveEvent = {
  readonly key: string;
  readonly source: ConfigSourceName;
  readonly durationMs: number;
};

export type MetricsRecorder = {
  readonly countResolution: (key: string, source: ConfigSourceName) => void;
  readonly countChange: (key: string, source: ConfigSourceName) => void;
  readonly countError: (key: string, stage: ResolutionErrorStage) => void;
  readonly observeDuration: (source: ConfigSourceName, seconds: number) => void;
};

export type LogSink = (message: string) => void;

export type ObservabilityOptions = {
  readonly metrics?: MetricsRecorder;
  /**
   * Receives one line per value change and one per source failure.
   *
   * There is deliberately no per-resolution logging: config reads sit on hot
   * paths (a per-guild check on a 30s poll, say), and a line per read would
   * bury the changes that actually matter.
   */
  readonly log?: LogSink;
};

/**
 * Builds resolver hooks from a metrics recorder and a log sink.
 *
 * Change lines carry the old value, the new value, and the layer that supplied
 * it, because "I set the env var and nothing happened" is the classic failure of
 * layered config and provenance is what answers it.
 */
export function createObservabilityHooks(
  options: ObservabilityOptions,
): ResolverHooks {
  const { metrics, log } = options;
  return {
    onResolve: (event: ResolveEvent) => {
      metrics?.countResolution(event.key, event.source);
      metrics?.observeDuration(event.source, event.durationMs / 1000);
    },
    onChange: (event: ChangeEvent) => {
      metrics?.countChange(event.key, event.source);
      log?.(
        `config ${event.key} changed: ${JSON.stringify(event.previous)} -> ${JSON.stringify(event.next)} (source: ${event.source})`,
      );
    },
    onSourceError: (key, source, message) => {
      metrics?.countError(key, "source");
      log?.(`config ${key}: source ${source} failed: ${message}`);
    },
  };
}
