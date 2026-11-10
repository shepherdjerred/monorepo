import { EnvValue } from "cdk8s-plus-31";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { otlpEgress } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function temporalTelemetryEnvironment(serviceName: string) {
  return {
    TELEMETRY_ENABLED: EnvValue.fromValue("true"),
    OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
    TELEMETRY_SERVICE_NAME: EnvValue.fromValue(serviceName),
  };
}

/** The internal OTLP collector is the only additional destination. */
export function temporalTelemetryEgressRule() {
  return otlpEgress();
}
