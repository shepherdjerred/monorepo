import { EnvValue } from "cdk8s-plus-31";
import {
  lokiOtlpEgress,
  otlpEgress,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { telemetryEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export function temporalTelemetryEnvironment(serviceName: string) {
  return telemetryEnv({ serviceName });
}

/**
 * The telemetry destinations of the Temporal worker image: spans to the
 * internal OTLP collector, and logs to Loki's OTLP receiver, the code default
 * in packages/temporal/src/observability/tracing.ts.
 */
export function temporalTelemetryEgressRules() {
  return [otlpEgress(), lokiOtlpEgress()];
}

/** Port of the Temporal SDK's Prometheus exporter in every worker image. */
export const TEMPORAL_SDK_METRICS_PORT = 9464;

/**
 * `TEMPORAL_METRICS_ADDRESS` for a Temporal worker: the SDK's Prometheus
 * exporter listens on every interface so the metrics Service can scrape it.
 */
export function temporalMetricsAddressEnv(): {
  TEMPORAL_METRICS_ADDRESS: EnvValue;
} {
  return {
    TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue(
      `0.0.0.0:${String(TEMPORAL_SDK_METRICS_PORT)}`,
    ),
  };
}
