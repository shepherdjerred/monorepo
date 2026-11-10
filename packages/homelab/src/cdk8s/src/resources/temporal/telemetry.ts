import { otlpEgress } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { telemetryEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export function temporalTelemetryEnvironment(serviceName: string) {
  return telemetryEnv({ serviceName });
}

/** The internal OTLP collector is the only additional destination. */
export function temporalTelemetryEgressRule() {
  return otlpEgress();
}
