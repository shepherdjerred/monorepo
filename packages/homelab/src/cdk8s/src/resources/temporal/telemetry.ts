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
