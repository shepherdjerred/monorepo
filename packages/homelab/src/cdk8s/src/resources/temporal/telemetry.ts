import { EnvValue } from "cdk8s-plus-31";
import { IntOrString } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";

export function temporalTelemetryEnvironment(serviceName: string) {
  return {
    TELEMETRY_ENABLED: EnvValue.fromValue("true"),
    OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
    TELEMETRY_SERVICE_NAME: EnvValue.fromValue(serviceName),
  };
}

/** The internal OTLP collector is the only additional destination. */
export function temporalTelemetryEgressRule() {
  return {
    to: [
      {
        namespaceSelector: {
          matchLabels: { "kubernetes.io/metadata.name": "alloy-gateway" },
        },
      },
    ],
    ports: [{ port: IntOrString.fromNumber(4318), protocol: "TCP" }],
  };
}
